import { base44 } from "@/api/base44Client";

// Express text fields that support AI/light-touch validation
export const EXPRESS_TEXT_VALIDATION_FIELDS = {
  differentiation: {
    questionId: "3",
    fieldName: "differentiation",
    questionTitle: "What makes your company different?",
    questionPrompt: "What makes your company different from other MSPs in your area?",
    minCharacters: 40,
    minMeaningfulWords: 4,
  },
  idealClient: {
    questionId: "12",
    fieldName: "idealClient",
    questionTitle: "Describe your ideal client",
    questionPrompt: "If you could describe your ideal client in one sentence, what would you say?",
    minCharacters: 40,
    minMeaningfulWords: 4,
  },
};

// Optional "other" fields that can be validated if non-empty
export const OPTIONAL_OTHER_TEXT_FIELDS = [
  "itCompanyTypeOther",
  "serviceOfferingsOther",
  "pricingPackagingOther",
  "companyGoalsOther",
  "brandToneOther",
  "targetIndustriesOther",
  "clientChallengesOther",
  "clientOutcomesOther",
];

// Placeholder patterns for local validation
const PLACEHOLDER_PATTERNS = [
  /^test$/i,
  /^asdf+$/i,
  /^n\/?a$/i,
  /^none$/i,
  /^nothing$/i,
  /^not sure$/i,
  /^idk$/i,
  /^i don't know$/i,
  /^tbd$/i,
  /^todo$/i,
  /^pending$/i,
  /^placeholder$/i,
  /^sample$/i,
  /^example$/i,
  /^xxx+$/i,
  /^abc+$/i,
  /^123+$/i,
  /^lorem ipsum$/i,
];

const JUNK_PATTERNS = [
  /^[^\w\s]+$/,
  /^(\w)\1{2,}$/,
  /^([a-z])\1([a-z])\2/i,
];

const FILLER_WORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'own', 'say', 'she', 'too', 'use']);

function countMeaningfulWords(text) {
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  return words.filter(w => !FILLER_WORDS.has(w)).length;
}

function hasBusinessContext(text) {
  const businessKeywords = [
    'client', 'customer', 'business', 'company', 'service', 'product',
    'market', 'industry', 'solution', 'help', 'support', 'manage',
    'provide', 'offer', 'specialize', 'focus', 'expert', 'professional',
    'small', 'medium', 'enterprise', 'startup', 'organization', 'team'
  ];
  const lower = text.toLowerCase();
  return businessKeywords.some(keyword => lower.includes(keyword));
}

/**
 * Get validation config for a field
 */
export function getExpressTextValidationConfig(fieldName) {
  return EXPRESS_TEXT_VALIDATION_FIELDS[fieldName] || null;
}

/**
 * Check if a field supports text validation
 */
export function isExpressTextValidationField(fieldName) {
  return fieldName in EXPRESS_TEXT_VALIDATION_FIELDS || OPTIONAL_OTHER_TEXT_FIELDS.includes(fieldName);
}

/**
 * Run local heuristic validation (fallback when server unavailable)
 */
export function runLocalExpressTextValidation({ fieldName, answer }) {
  const config = EXPRESS_TEXT_VALIDATION_FIELDS[fieldName];
  const isOptionalOther = OPTIONAL_OTHER_TEXT_FIELDS.includes(fieldName);
  
  // Optional field, empty is OK
  if (isOptionalOther && (!answer || !answer.trim())) {
    return {
      success: true,
      status: 'complete',
      score: 100,
      message: 'Optional field is empty (no validation needed).',
      suggestions: [],
      reason_codes: [],
      fieldName,
      questionId: config?.questionId || '',
    };
  }
  
  const trimmed = (answer || '').trim();
  const minCharacters = config?.minCharacters || 15;
  const minMeaningfulWords = config?.minMeaningfulWords || 3;
  
  // Blank
  if (trimmed.length === 0) {
    return {
      success: true,
      status: 'incomplete',
      score: 0,
      message: 'This field requires an answer.',
      suggestions: ['Please provide a brief response to continue.'],
      reason_codes: ['blank_answer'],
      fieldName,
      questionId: config?.questionId || '',
    };
  }
  
  // Placeholder
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        success: true,
        status: 'incomplete',
        score: 10,
        message: 'This answer appears to be placeholder text.',
        suggestions: ['Please replace with your actual response.'],
        reason_codes: ['placeholder_detected'],
        fieldName,
        questionId: config?.questionId || '',
      };
    }
  }
  
  // Junk
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(trimmed.replace(/\s+/g, ''))) {
      return {
        success: true,
        status: 'incomplete',
        score: 15,
        message: 'This answer does not contain meaningful content.',
        suggestions: ['Please provide a complete thought or sentence.'],
        reason_codes: ['junk_content'],
        fieldName,
        questionId: config?.questionId || '',
      };
    }
  }
  
  // Too short
  if (trimmed.length < minCharacters) {
    return {
      success: true,
      status: 'incomplete',
      score: 25,
      message: `This answer is too short (minimum ~${minCharacters} characters).`,
      suggestions: ['Please expand on your response with more detail.'],
      reason_codes: ['too_short'],
      fieldName,
      questionId: config?.questionId || '',
    };
  }
  
  // Not enough meaningful words
  const meaningfulCount = countMeaningfulWords(trimmed);
  if (meaningfulCount < minMeaningfulWords) {
    return {
      success: true,
      status: 'needs_work',
      score: 50,
      message: 'This answer could use more specific detail.',
      suggestions: [
        'Consider adding 1-2 more sentences to clarify your thoughts.',
        'What specific examples or details could you include?',
      ],
      reason_codes: ['not_enough_detail'],
      fieldName,
      questionId: config?.questionId || '',
    };
  }
  
  // Lacks business context
  if (minMeaningfulWords >= 4 && !hasBusinessContext(trimmed)) {
    return {
      success: true,
      status: 'needs_work',
      score: 65,
      message: 'This answer may benefit from more business-specific context.',
      suggestions: [
        'Try mentioning your clients, services, or industry focus.',
        'What makes your situation unique?',
      ],
      reason_codes: ['lacks_business_context'],
      fieldName,
      questionId: config?.questionId || '',
    };
  }
  
  // Complete
  return {
    success: true,
    status: 'complete',
    score: 90,
    message: 'Answer looks good.',
    suggestions: [],
    reason_codes: [],
    fieldName,
    questionId: config?.questionId || '',
  };
}

/**
 * Normalize server validation result to standard shape
 */
export function normalizeExpressValidationResult(result, fallbackContext = {}) {
  if (!result || typeof result !== 'object') {
    return {
      success: false,
      status: 'error',
      score: 0,
      message: 'Invalid validation response.',
      suggestions: [],
      reason_codes: ['invalid_response'],
      ...fallbackContext,
    };
  }
  
  // Handle both { data: ... } and direct object shapes
  const data = result.data || result;
  
  if (!data.success) {
    return {
      success: false,
      status: 'error',
      score: 0,
      message: data.message || 'Validation failed.',
      suggestions: data.suggestions || [],
      reason_codes: data.reason_codes || ['validator_error'],
      ...fallbackContext,
    };
  }
  
  return {
    success: true,
    status: data.status || 'complete',
    score: typeof data.score === 'number' ? data.score : 0,
    message: data.message || '',
    suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
    reason_codes: Array.isArray(data.reason_codes) ? data.reason_codes : [],
    ...fallbackContext,
  };
}

/**
 * Main validation function: calls server, falls back to local
 */
export async function validateExpressTextAnswer({ fieldName, answer, businessName = '', domain = '', context = {} }) {
  const config = EXPRESS_TEXT_VALIDATION_FIELDS[fieldName];
  const isOptionalOther = OPTIONAL_OTHER_TEXT_FIELDS.includes(fieldName);
  
  // Unsupported field: return safe complete result
  if (!config && !isOptionalOther) {
    return {
      success: true,
      status: 'complete',
      score: 100,
      message: 'Field validation not configured (passing through).',
      suggestions: [],
      reason_codes: [],
      fieldName,
      questionId: '',
    };
  }
  
  // Blank answer: return local incomplete without calling server
  if (!answer || !answer.trim()) {
    return runLocalExpressTextValidation({ fieldName, answer });
  }
  
  // Call server validation
  try {
    const requestBody = {
      questionId: config?.questionId || '',
      fieldName,
      questionTitle: config?.questionTitle || '',
      questionPrompt: config?.questionPrompt || '',
      answer,
      businessName,
      domain,
      context,
    };
    
    const response = await base44.functions.invoke('validateExpressQuestionText', requestBody);
    
    // Normalize response (handles both { data } and direct shapes)
    const normalized = normalizeExpressValidationResult(response, {
      fieldName,
      questionId: config?.questionId || '',
    });
    
    return normalized;
  } catch (serverErr) {
    // Server unavailable: use local fallback
    const localResult = runLocalExpressTextValidation({ fieldName, answer });
    return {
      ...localResult,
      reason_codes: [...(localResult.reason_codes || []), 'server_validation_unavailable'],
    };
  }
}