import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const parsePayload = (value) => {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
};

const safeError = (error) => {
  try {
    return {
      message: error?.message || String(error),
      name: error?.name || 'Error',
      stack: error?.stack || null,
    };
  } catch {
    return { message: String(error) };
  }
};

const incrementRetryCount = (value) => {
  if (typeof value === 'number' && !isNaN(value)) return value + 1;
  return 1;
};

const mapExpressPayloadToFormSubmissionRecord = (payload) => {
  const { metadata, userdata } = payload;
  // Force service_type to express - do not trust incoming value
  const normalizedMetadata = { ...metadata, service_type: 'express' };
  const normalizedPayload = { metadata: normalizedMetadata, userdata };
  
  const { metadata: normMd, userdata: normUd } = normalizedPayload;
  return {
    business_name: normMd.business_name || '',
    submission_datetime: normMd.submission_datetime || new Date().toISOString(),
    service_type: normMd.service_type || 'express',
    it_company_type: Array.isArray(userdata.it_company_type) ? userdata.it_company_type : [],
    it_company_type_other: userdata.it_company_type_other || '',
    service_offerings: Array.isArray(userdata.service_offerings) ? userdata.service_offerings : [],
    service_offerings_other: userdata.service_offerings_other || '',
    differentiation: userdata.differentiation || '',
    geographic_areas: userdata.geographic_areas || '',
    geographic_area_meta: userdata.geographic_area_meta || null,
    pricing_packaging: userdata.pricing_packaging || '',
    pricing_packaging_other: userdata.pricing_packaging_other || '',
    company_goals: Array.isArray(userdata.company_goals) ? userdata.company_goals : (userdata.company_goals ? [userdata.company_goals] : []),
    company_goals_other: userdata.company_goals_other || '',
    brand_tone: userdata.brand_tone || '',
    brand_tone_other: userdata.brand_tone_other || '',
    target_industries: Array.isArray(userdata.target_industries) ? userdata.target_industries : [],
    target_industries_other: userdata.target_industries_other || '',
    client_size: userdata.client_size || '',
    client_challenges: Array.isArray(userdata.client_challenges) ? userdata.client_challenges : [],
    client_challenges_other: userdata.client_challenges_other || '',
    client_outcomes: Array.isArray(userdata.client_outcomes) ? userdata.client_outcomes : [],
    client_outcomes_other: userdata.client_outcomes_other || '',
    ideal_client: userdata.ideal_client || '',
  };
};

const getNewestRecord = (records) => {
  if (!records || records.length === 0) return null;
  if (records.length === 1) return records[0];

  return records.reduce((newest, current) => {
    const newestTime = new Date(
      newest.last_retry_at || newest.created_at_server || newest.created_date || '1970-01-01'
    ).getTime();
    const currentTime = new Date(
      current.last_retry_at || current.created_at_server || current.created_date || '1970-01-01'
    ).getTime();
    return currentTime > newestTime ? current : newest;
  });
};

const hasRequiredExpressPayloadFields = (payload) => {
  if (!payload || typeof payload !== 'object') return false;
  if (!payload.metadata || typeof payload.metadata !== 'object') return false;
  if (!payload.userdata || typeof payload.userdata !== 'object' || Array.isArray(payload.userdata)) return false;
  if (!payload.metadata.business_name || typeof payload.metadata.business_name !== 'string') return false;
  if (!payload.metadata.businessDomain || typeof payload.metadata.businessDomain !== 'string') return false;
  return true;
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Wrap auth check in try/catch
    let user;
    try {
      user = await base44.auth.me();
    } catch (authErr) {
      return Response.json(
        { success: false, error: { message: 'Forbidden: Admin access required' } },
        { status: 403 }
      );
    }

    const isAdmin = user?.role === 'admin';
    const isBenjamin = user?.email?.toLowerCase() === 'benjamin.hines8@gmail.com';

    if (!isAdmin && !isBenjamin) {
      return Response.json(
        { success: false, error: { message: 'Forbidden: Admin access required' } },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { intakeId, questionnaireSessionId, forceRetry = false } = body;

    if (!intakeId && !questionnaireSessionId) {
      return Response.json(
        { success: false, error: { message: 'intakeId or questionnaireSessionId is required' } },
        { status: 400 }
      );
    }

    let intakeRecord;
    if (intakeId) {
      const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter({ id: intakeId });
      intakeRecord = records && records.length > 0 ? records[0] : null;
    } else {
      const records = await base44.asServiceRole.entities.FormSubmissionIntake.filter({
        questionnaire_session_id: questionnaireSessionId,
      });
      intakeRecord = getNewestRecord(records);
    }

    if (!intakeRecord) {
      return Response.json(
        { success: false, error: { message: 'Intake record not found' } },
        { status: 404 }
      );
    }

    const intakeIdActual = intakeRecord.id;

    if (intakeRecord.linked_submission_id && !forceRetry) {
      return Response.json({
        success: true,
        alreadySubmitted: true,
        linkedSubmissionId: intakeRecord.linked_submission_id,
        intakeId: intakeIdActual,
      });
    }

    const transformed = parsePayload(intakeRecord.transformed_payload_json);
    if (!transformed) {
      const errorPayload = { message: 'Malformed transformed payload JSON' };
      await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(errorPayload),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intakeRecord.retry_count),
      });
      return Response.json(
        {
          success: false,
          error: errorPayload,
          intakeId: intakeIdActual,
        },
        { status: 400 }
      );
    }

    if (!hasRequiredExpressPayloadFields(transformed)) {
      const errorPayload = {
        message: 'Missing required Express payload fields',
        details: {
          hasMetadata: !!transformed.metadata,
          hasUserdata: !!transformed.userdata && !Array.isArray(transformed.userdata),
          hasBusinessName: !!transformed.metadata?.business_name,
          hasBusinessDomain: !!transformed.metadata?.businessDomain,
        },
      };
      await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(errorPayload),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intakeRecord.retry_count),
      });
      return Response.json(
        {
          success: false,
          error: errorPayload,
          intakeId: intakeIdActual,
        },
        { status: 400 }
      );
    }

    if (questionnaireSessionId && !forceRetry) {
      try {
        const existingSubmissions = await base44.asServiceRole.entities.FormSubmission.filter({
          questionnaire_session_id: questionnaireSessionId,
        });
        if (existingSubmissions && existingSubmissions.length > 0) {
          const existingId = existingSubmissions[0].id;
          await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
            status: 'retry_success',
            linked_submission_id: existingId,
            retry_error_json: '',
            last_retry_at: new Date().toISOString(),
            retry_count: incrementRetryCount(intakeRecord.retry_count),
          });
          return Response.json({
            success: true,
            alreadySubmitted: true,
            linkedSubmissionId: existingId,
            intakeId: intakeIdActual,
          });
        }
      } catch {
        // Filter by questionnaire_session_id may not be supported - skip safely
      }
    }

    // Normalize service_type before mapping
    transformed.metadata.service_type = 'express';
    const submissionRecord = mapExpressPayloadToFormSubmissionRecord(transformed);

    let createdSubmission;
    try {
      createdSubmission = await base44.asServiceRole.entities.FormSubmission.create(submissionRecord);
    } catch (createError) {
      const errorPayload = safeError(createError);
      await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
        status: 'retry_failed',
        retry_error_json: JSON.stringify(errorPayload),
        last_retry_at: new Date().toISOString(),
        retry_count: incrementRetryCount(intakeRecord.retry_count),
      });
      return Response.json(
        {
          success: false,
          error: errorPayload,
          intakeId: intakeIdActual,
        },
        { status: 500 }
      );
    }

    await base44.asServiceRole.entities.FormSubmissionIntake.update(intakeIdActual, {
      status: 'retry_success',
      linked_submission_id: createdSubmission.id,
      retry_error_json: '',
      last_retry_at: new Date().toISOString(),
      retry_count: incrementRetryCount(intakeRecord.retry_count),
    });

    return Response.json({
      success: true,
      linkedSubmissionId: createdSubmission.id,
      intakeId: intakeIdActual,
    });
  } catch (error) {
    return Response.json(
      { success: false, error: safeError(error) },
      { status: 500 }
    );
  }
});