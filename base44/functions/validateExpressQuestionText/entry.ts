import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACEHOLDER_ANSWERS = new Set([
  'test', 'asdf', 'n/a', 'na', 'none', 'not sure', 'idk', "i don't know",
  'unknown', 'tbd', 'todo', 'placeholder', 'example', 'sample',
  'xxx', 'aaa', 'bbb', 'ccc', '123', 'abc',
]);

const SUPPORTED_TEXT_FIELDS = {
  '3': { fieldName: 'differentiation', purpose: 'explain what makes the IT company different', minWords: 4, minLength: 40 },
  '12': { fieldName: 'idealClient', purpose: 'describe the ideal client', minWords: 4, minLength: 40 },
};

const OTHER_FIELDS = new Set([
  'itCompanyTypeOther', 'serviceOfferingsOther', 'pricingPackagingOther',
  'companyGoalsOther', 'brandToneOther', 'targetIndustriesOther',
  'clientChallengesOther', 'clientOutcomesOther',
]);

// ─── Helper Functions ─────────────────────────────────────────────────────────

function classifyError(error) {
  if (!error) return 'unknown';
  const msg = (error.message || '').toLowerCase();
  const name = (error.name || '').toLowerCase();

  if (name === 'aborterror' || msg.includes('timeout') || msg.includes('aborted')) return 'timeout';
  if (msg.includes('auth') || msg.includes('token') || msg.includes('unauthorized')) return 'auth';
  if (msg.includes('permission') || msg.includes('forbidden')) return 'permission';
  if (msg.includes('rate limit')) return 'rate_limit';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('cors')) return 'network';
  if (msg.includes('internal server') || msg.includes('bad gateway')) return 'server';
  return 'unknown';
}

function countMeaningfulWords(text) {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'although', 'though', 'that', 'this', 'these', 'those', 'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom']);
  return words.filter(w => !stopWords.has(w)).length;
}

function hasRepeatedCharacters(text) {
  return /(.)\1{4,}/.test(text);
}

function isOnlyPunctuation(text) {
  return /^[\s\p{P}]+$/u.test(text);
}

function looksLikePlaceholder(text) {
  return PLACEHOLDER_ANSWERS.has(text.toLowerCase().trim());
}

function buildLocalValidationResult(answer, questionId, fieldName) {
  const trimmed = (answer || '').trim();

  if (trimmed.length === 0) {
    return { success: true, status: 'incomplete', score: 0, message: 'Please provide an answer for this question.', suggestions: ['Add a brief response to help us understand your business better.'], reason_codes: ['blank_answer'], questionId, fieldName };
  }
  if (isOnlyPunctuation(trimmed)) {
    return { success: true, status: 'incomplete', score: 0, message: 'Your answer appears to contain only punctuation or special characters.', suggestions: ['Please enter actual words or text that describe your business.'], reason_codes: ['punctuation_only'], questionId, fieldName };
  }
  if (hasRepeatedCharacters(trimmed)) {
    return { success: true, status: 'incomplete', score: 5, message: 'Your answer contains repeated characters that look like placeholder text.', suggestions: ['Replace with a meaningful response about your business.'], reason_codes: ['repeated_characters'], questionId, fieldName };
  }
  if (looksLikePlaceholder(trimmed)) {
    return { success: true, status: 'incomplete', score: 5, message: 'Your answer looks like placeholder text.', suggestions: ['Please provide a real answer about your business.'], reason_codes: ['placeholder_detected'], questionId, fieldName };
  }
  if (OTHER_FIELDS.has(fieldName)) {
    return { success: true, status: 'complete', score: 100, message: 'Answer accepted.', suggestions: [], reason_codes: ['other_field_accepted'], questionId, fieldName };
  }

  const config = SUPPORTED_TEXT_FIELDS[questionId];
  if (!config) {
    return { success: true, status: 'complete', score: 100, message: 'Answer accepted (field not configured for validation).', suggestions: [], reason_codes: ['unsupported_field'], questionId, fieldName };
  }

  const wordCount = countMeaningfulWords(trimmed);
  const charLength = trimmed.length;

  if (charLength < 15) {
    return { success: true, status: 'incomplete', score: 10, message: 'Your answer is too short.', suggestions: [`Please provide at least 15 characters. Current: ${charLength} characters.`], reason_codes: ['too_short'], questionId, fieldName };
  }
  if (wordCount < config.minWords) {
    return { success: true, status: 'incomplete', score: 20, message: 'Your answer needs more meaningful content.', suggestions: [`Please provide at least ${config.minWords} meaningful words. Current: ${wordCount} words.`], reason_codes: ['insufficient_words'], questionId, fieldName };
  }
  if (charLength < config.minLength) {
    return { success: true, status: 'needs_work', score: 50, message: 'Your answer is a bit short. Consider adding more detail.', suggestions: [`Aim for at least ${config.minLength} characters to provide a complete response. Current: ${charLength} characters.`], reason_codes: ['below_recommended_length'], questionId, fieldName };
  }

  return { success: true, status: 'complete', score: 100, message: 'Answer looks good!', suggestions: [], reason_codes: ['validation_passed'], questionId, fieldName };
}

async function invokeAiValidation({ answer, questionTitle, questionPrompt, businessName, domain, questionId, fieldName, base44 }) {
  try {
    const config = SUPPORTED_TEXT_FIELDS[questionId];
    if (!config) return null;

    const prompt = `You are a friendly, light-touch validator for business questionnaire responses. Your goal is to check if the answer is usable, not to grade writing quality or marketing effectiveness.

QUESTION: ${questionTitle || config.purpose}
PROMPT: ${questionPrompt || `Please ${config.purpose}`}
BUSINESS NAME: ${businessName || 'Not provided'}
BUSINESS DOMAIN: ${domain || 'Not provided'}
USER ANSWER: "${answer}"

Evaluate whether this answer is:
1. Blank or nearly blank (incomplete)
2. Placeholder text like "test", "asdf", "n/a", "none", "not sure", "idk" (incomplete)
3. Too short or vague to be useful (needs_work)
4. Unfinished or looks like it was cut off (needs_work)
5. Contains no meaningful business/context information (needs_work)
6. Relevant and provides enough information to proceed (complete)

Be lenient - this is not about perfect grammar or marketing quality. Just check if the answer has enough substance to be usable.

Respond with this exact JSON structure:
{
  "status": "complete" | "needs_work" | "incomplete",
  "score": number (0-100),
  "message": "friendly message to user",
  "suggestions": ["suggestion 1", "suggestion 2"],
  "reason_codes": ["code1", "code2"]
}

Reason codes can be: blank_answer, placeholder_detected, too_short, insufficient_words, vague_answer, looks_unfinished, irrelevant_content, validation_passed`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['complete', 'needs_work', 'incomplete'] },
          score: { type: 'number', minimum: 0, maximum: 100 },
          message: { type: 'string' },
          suggestions: { type: 'array', items: { type: 'string' } },
          reason_codes: { type: 'array', items: { type: 'string' } },
        },
        required: ['status', 'score', 'message', 'suggestions', 'reason_codes'],
      },
    });

    return response;
  } catch (error) {
    console.error('[validateExpressQuestionText] AI validation failed:', error.message);
    return null;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return Response.json({ success: false, error: { message: 'Method not allowed' } }, { status: 405, headers: corsHeaders });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: { message: 'Invalid JSON body' } }, { status: 400, headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);

    const { questionId, fieldName, questionTitle, questionPrompt, answer, businessName, domain, context } = body;

    if (!questionId || !fieldName || answer === undefined || answer === null) {
      return Response.json({
        success: false, status: 'error', score: 0,
        message: 'Missing required validation parameters.',
        suggestions: [], reason_codes: ['missing_parameters'],
        questionId: questionId || 'unknown',
        fieldName: fieldName || 'unknown',
      }, { status: 400, headers: corsHeaders });
    }

    const localResult = buildLocalValidationResult(answer, questionId, fieldName);

    if (OTHER_FIELDS.has(fieldName) || !SUPPORTED_TEXT_FIELDS[questionId]) {
      return Response.json(localResult, { headers: corsHeaders });
    }

    if (localResult.status === 'incomplete') {
      return Response.json(localResult, { headers: corsHeaders });
    }

    const aiResult = await invokeAiValidation({ answer, questionTitle, questionPrompt, businessName, domain, questionId, fieldName, base44 });

    if (!aiResult) {
      return Response.json(localResult, { headers: corsHeaders });
    }

    return Response.json({
      success: true,
      status: aiResult.status,
      score: aiResult.score,
      message: aiResult.message,
      suggestions: aiResult.suggestions,
      reason_codes: aiResult.reason_codes,
      questionId,
      fieldName,
    }, { headers: corsHeaders });

  } catch (error) {
    const errorKind = classifyError(error);
    console.error('[validateExpressQuestionText] Handler error:', error.message, errorKind);

    return Response.json({
      success: false, status: 'error', score: 0,
      message: 'Validation could not be completed right now.',
      suggestions: ['Please try again in a moment.'],
      reason_codes: ['validator_error'],
      questionId: 'unknown',
      fieldName: 'unknown',
    }, { status: 500, headers: corsHeaders });
  }
});