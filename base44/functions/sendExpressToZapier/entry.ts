import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Only allow POST
    if (req.method !== 'POST') {
      return Response.json({
        success: false,
        error: 'Method not allowed',
      }, {
        status: 405,
        headers: corsHeaders,
      });
    }

    // Parse JSON body
    let payload;
    try {
      payload = await req.json();
    } catch (parseErr) {
      return Response.json({
        success: false,
        error: 'Invalid JSON payload',
      }, {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Read webhook URL from environment
    const webhookUrl = Deno.env.get('EXPRESS_ZAPIER_WEBHOOK_URL')?.trim();
    if (!webhookUrl) {
      return Response.json({
        success: false,
        error: 'Express Zapier webhook URL is not configured',
      }, {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Send to Zapier with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let zapierResponse;
    try {
      zapierResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      
      if (fetchErr.name === 'AbortError') {
        return Response.json({
          success: false,
          error: 'Express Zapier webhook timed out',
        }, {
          status: 504,
          headers: corsHeaders,
        });
      }
      
      throw fetchErr;
    }

    // Check Zapier response status
    if (!zapierResponse.ok) {
      const zapierText = await zapierResponse.text().catch(() => '');
      return Response.json({
        success: false,
        error: 'Express Zapier webhook failed',
        zapierStatus: zapierResponse.status,
        zapierBody: zapierText,
      }, {
        status: 502,
        headers: corsHeaders,
      });
    }

    // Success
    const zapierData = await zapierResponse.json().catch(() => null);
    return Response.json({
      success: true,
      message: 'Data sent to Express Zapier successfully',
      zapierResponse: zapierData,
    }, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error.message || 'Unknown Zapier send error',
    }, {
      status: 500,
    });
  }
});