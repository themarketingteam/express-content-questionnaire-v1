import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";

import {
  base44,
  base44RuntimeConfig,
  getBase44FunctionEndpoint,
} from "../src/api/base44Client.js";

import {
  buildBase44FunctionEndpoint,
  resolveBase44RuntimeConfig,
} from "../src/lib/base44RuntimeConfig.js";
import {
  createAnswerHash,
  createValidationUnavailableResult,
  EXPRESS_VALIDATION_UNAVAILABLE_MESSAGE,
  validateExpressTextAnswer,
} from "../src/lib/expressTextValidation.js";
import {
  runSubmitTextValidation,
} from "../src/lib/expressSubmitTextValidation.js";
import {
  getExpressQuestionDisplayStatus,
  QUESTION_STATUS,
} from "../src/lib/questionValidationStatus.js";
import {
  buildIncompleteQuestionSummary,
  hasBlockingIncompleteItems,
} from "../src/lib/incompleteQuestionSummary.js";

const APP_ID = "6913611c0ea0f6b631343af8";
const SERVER_URL = "https://base44.app";
const validAnswers = {
  differentiation: "We provide unusually responsive managed IT support for local professional services firms.",
  idealClient: "Our ideal client is a growing professional services company that values a proactive technology partner.",
};

after(() => base44.cleanup());

test("a non-empty required answer is complete without running optional validation", () => {
  const formData = { differentiation: "A", idealClient: "B" };
  const status = getExpressQuestionDisplayStatus({
    questionId: "3",
    formData,
    touchedQuestions: { "3": true },
    validationStatus: {},
    validatingFields: [],
    isQuestionComplete: (questionId) => questionId === 3,
  });
  assert.equal(status, QUESTION_STATUS.complete);

  const summary = buildIncompleteQuestionSummary({
    formData,
    touchedQuestions: { "3": true, "12": true },
    validationStatus: {},
    validatingFields: [],
    isQuestionComplete: () => true,
  });
  assert.equal(hasBlockingIncompleteItems(summary), false);
  assert.equal(summary.completeCount, 12);
  assert.equal(summary.attentionItems.some((item) => ["3", "12"].includes(item.questionId)), false);
  assert.equal(summary.validationItems.every((item) => item.blocking === false), true);
});

test("a non-empty answer can submit when validation times out", async () => {
  const original = structuredClone(validAnswers);
  const timeoutResult = await validateExpressTextAnswer(
    {
      fieldName: "differentiation",
      answer: validAnswers.differentiation,
      businessName: "Timeout Test",
      domain: "timeout.invalid",
    },
    {
      invoke: () => new Promise(() => {}),
      timeoutMs: 5,
    },
  );

  assert.equal(timeoutResult.status, "error");
  assert.match(timeoutResult.message, /temporarily unavailable/i);
  assert.ok(timeoutResult.reason_codes.includes("validation_timeout"));

  const submitResult = await runSubmitTextValidation({
    formData: validAnswers,
    validationStatus: {},
    businessName: "Timeout Test",
    domain: "timeout.invalid",
    validateAnswer: async () => timeoutResult,
  });
  assert.equal(submitResult.ok, true);
  assert.equal(submitResult.blockingIssues.length, 0);
  assert.equal(submitResult.warnings.every((warning) => warning.kind === "validation_unavailable"), true);
  assert.deepEqual(validAnswers, original, "validation must not mutate or erase answers");
});

test("network/backend failures are non-blocking and preserve answers", async () => {
  const formData = structuredClone(validAnswers);
  const original = structuredClone(formData);
  const result = await runSubmitTextValidation({
    formData,
    validationStatus: {},
    businessName: "Error Test",
    domain: "error.invalid",
    validateAnswer: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.blockingIssues.length, 0);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0].message, /temporarily unavailable/i);
  assert.deepEqual(formData, original);
});

test("a rejected AI quality result is advice, never a submission blocker", async () => {
  const result = await runSubmitTextValidation({
    formData: validAnswers,
    validationStatus: {},
    businessName: "Rejected Test",
    domain: "rejected.invalid",
    validateAnswer: async ({ fieldName, answer }) => ({
      success: true,
      status: "incomplete",
      message: "Consider adding more detail.",
      suggestions: ["Add a specific example."],
      fieldName,
      answerHash: createAnswerHash(answer),
      validatedAt: new Date().toISOString(),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.blockingIssues.length, 0);
  assert.equal(result.warnings.length, 2);
  assert.equal(result.warnings.every((warning) => warning.status === "incomplete"), true);
});

test("genuinely empty required text answers remain blocked", async () => {
  let invocations = 0;
  const result = await runSubmitTextValidation({
    formData: { differentiation: "   ", idealClient: validAnswers.idealClient },
    validationStatus: {},
    businessName: "Empty Test",
    domain: "empty.invalid",
    validateAnswer: async () => {
      invocations += 1;
      return { success: true, status: "complete", suggestions: [], reason_codes: [] };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.blockingIssues.length, 1);
  assert.equal(result.blockingIssues[0].fieldName, "differentiation");
  assert.equal(result.blockingIssues[0].status, "empty_required");
  assert.equal(invocations, 1, "the non-empty field may still be checked");
});

test("manual validation invokes the correct function and preserves a successful result", async () => {
  const calls = [];
  const result = await validateExpressTextAnswer(
    {
      fieldName: "differentiation",
      answer: validAnswers.differentiation,
      businessName: "Success Test",
      domain: "success.invalid",
    },
    {
      invoke: async (name, body) => {
        calls.push({ name, body });
        return {
          data: {
            success: true,
            status: "complete",
            score: 97,
            message: "Answer looks good.",
            suggestions: [],
            reason_codes: ["validation_passed"],
          },
        };
      },
      timeoutMs: 100,
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "validateExpressQuestionText");
  assert.equal(calls[0].body.answer, validAnswers.differentiation);
  assert.equal(result.status, "complete");
  assert.equal(result.score, 97);
  assert.equal(result.message, "Answer looks good.");
});

test("malformed validation responses become a clear non-blocking outage result", async () => {
  const result = await validateExpressTextAnswer(
    { fieldName: "idealClient", answer: validAnswers.idealClient },
    { invoke: async () => ({ data: { unexpected: true } }), timeoutMs: 100 },
  );
  assert.equal(result.status, "error");
  assert.equal(result.blocking, false);
  assert.equal(result.answerHash, createAnswerHash(validAnswers.idealClient));
  assert.equal(result.message, EXPRESS_VALIDATION_UNAVAILABLE_MESSAGE);
});

test("runtime configuration rejects null-like values and always builds a non-null function URL", () => {
  for (const invalid of [null, undefined, "", " ", "null", "NULL", "undefined"]) {
    const runtime = resolveBase44RuntimeConfig(
      { appId: invalid, serverUrl: invalid, token: invalid, functionsVersion: invalid },
      { appId: APP_ID, serverUrl: SERVER_URL },
    );
    const endpoint = buildBase44FunctionEndpoint(runtime, "validateExpressQuestionText");
    assert.equal(runtime.appId, APP_ID);
    assert.equal(runtime.serverUrl, SERVER_URL);
    assert.equal(runtime.token, null);
    assert.doesNotMatch(endpoint, /\/(?:null|undefined)(?:\/|$)/i);
    assert.doesNotMatch(endpoint, /\/apps\/\//);
    assert.equal(
      endpoint,
      `${SERVER_URL}/api/apps/${APP_ID}/functions/validateExpressQuestionText`,
    );
  }
});

test("the production SDK client starts with the guarded app and function endpoint", () => {
  assert.equal(base44RuntimeConfig.appId, APP_ID);
  assert.equal(base44RuntimeConfig.serverUrl, SERVER_URL);
  assert.deepEqual(base44.getConfig(), {
    appId: APP_ID,
    serverUrl: SERVER_URL,
    requiresAuth: false,
  });
  assert.equal(
    getBase44FunctionEndpoint("validateExpressQuestionText"),
    `${SERVER_URL}/api/apps/${APP_ID}/functions/validateExpressQuestionText`,
  );
});

test("the deployed function CORS policy supports credentialless live and preview requests", async () => {
  const source = await readFile(
    new URL("../base44/functions/validateExpressQuestionText/entry.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /'Access-Control-Allow-Origin': '\*'/);
  assert.match(source, /X-App-Id/);
  assert.doesNotMatch(source, /Access-Control-Allow-Credentials/i);
  assert.match(source, /function withValidationPolicy/);
  assert.match(source, /}, false\)/);
  assert.match(source, /blocking: false/);
  assert.match(source, /optional-validation-v1/);
});

test("unavailable results always retain the answer fingerprint", () => {
  const answer = "Keep this exact client answer.";
  const result = createValidationUnavailableResult({ fieldName: "idealClient", answer });
  assert.equal(result.answerHash, createAnswerHash(answer));
  assert.equal(result.blocking, false);
  assert.match(result.message, /answer is saved/i);
});

test("the validation hook exposes the reset used by successful submission cleanup", async () => {
  const source = await readFile(
    new URL("../src/lib/hooks/useExpressTextValidation.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /const resetAllFields = useCallback/);
  assert.match(source, /setValidationStatus\(\{\}\)/);
  assert.match(source, /setValidatingFields\(\{\}\)/);
  assert.match(source, /\n\s+resetAllFields,/);
});
