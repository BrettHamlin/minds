/**
 * SpecEngine Mind — spec generation, sessions, Q&A, database persistence.
 *
 * Leaf Mind: no children. Owns all business logic for spec workflows.
 * Routes work units by keyword matching on workUnit.request.
 */

import { createMind } from "../../../server-base.js";
import type { WorkUnit, WorkResult } from "../../../mind.js";
import { AppError } from "./errors.js";

// Services
import { createSpec, getSpec, updateSpecAnalysis, transitionSpecState } from "./services/spec.js";
import { createSession, getActiveSession, updateSessionStep, deactivateSession } from "./services/session.js";
import { startBlindQA, generateNextQuestion, completeBlindQA, isComplete } from "./services/blind-qa.js";
import { submitAnswer } from "./services/answer.js";
import { createQuestion, getNextUnanswered, getQuestionCount, getQuestionsWithAnswers } from "./services/question.js";
import { createRoles, addRoleMembers, getAllMemberUserIds } from "./services/role.js";
import {
  createSlackChannel,
  inviteMembers,
  postWelcomeMessage,
  createChannelRecord,
} from "./services/channel.js";
import { analyzeDescription, generateChannelNames } from "./services/llm.js";
import { generateSpecContent, getSpecUrl } from "./services/spec-generator.js";
import { startSessionCleanup } from "./services/session-cleanup.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const req = workUnit.request.toLowerCase();
  const ctx = workUnit.context as Record<string, unknown> | undefined;

  try {
    // --- Spec lifecycle ---
    if (req.includes("create spec") || req.includes("create a spec")) {
      const { title, description, pmUserId, pmDisplayName } = ctx as {
        title: string; description: string; pmUserId: string; pmDisplayName?: string;
      };
      const spec = await createSpec(title, description, pmUserId, pmDisplayName);
      return { status: "handled", data: spec };
    }

    if (req.includes("get spec")) {
      const { specId } = ctx as { specId: string };
      const spec = await getSpec(specId);
      return { status: "handled", data: spec };
    }

    if (req.includes("update spec analysis") || req.includes("analyze spec")) {
      const { specId, complexityScore, totalQuestions, title } = ctx as {
        specId: string; complexityScore: number; totalQuestions: number; title: string;
      };
      const spec = await updateSpecAnalysis(specId, complexityScore, totalQuestions, title);
      return { status: "handled", data: spec };
    }

    if (req.includes("transition spec")) {
      const { specId, from, to } = ctx as { specId: string; from: string; to: string };
      const spec = await transitionSpecState(
        specId,
        from as Parameters<typeof transitionSpecState>[1],
        to as Parameters<typeof transitionSpecState>[2]
      );
      return { status: "handled", data: spec };
    }

    if (req.includes("generate spec content") || req.includes("generate specification")) {
      const { specId } = ctx as { specId: string };
      const result = await generateSpecContent(specId);
      return { status: "handled", data: result };
    }

    if (req.includes("get spec url")) {
      const { specId } = ctx as { specId: string };
      return { status: "handled", data: { url: getSpecUrl(specId) } };
    }

    // --- Session lifecycle ---
    if (req.includes("create session")) {
      const { specId, pmUserId, slackChannelId } = ctx as {
        specId: string; pmUserId: string; slackChannelId: string;
      };
      const session = await createSession(specId, pmUserId, slackChannelId);
      return { status: "handled", data: session };
    }

    if (req.includes("get active session")) {
      const { pmUserId } = ctx as { pmUserId: string };
      const session = await getActiveSession(pmUserId);
      return { status: "handled", data: session };
    }

    if (req.includes("update session")) {
      const { sessionId, step, metadata } = ctx as {
        sessionId: string; step: Parameters<typeof updateSessionStep>[1]; metadata?: Record<string, unknown>;
      };
      const session = await updateSessionStep(sessionId, step, metadata);
      return { status: "handled", data: session };
    }

    if (req.includes("deactivate session")) {
      const { sessionId } = ctx as { sessionId: string };
      const session = await deactivateSession(sessionId);
      return { status: "handled", data: session };
    }

    // --- Blind QA ---
    if (req.includes("start blind qa") || req.includes("start blindqa")) {
      const { specId } = ctx as { specId: string };
      const question = await startBlindQA(specId);
      return { status: "handled", data: question };
    }

    if (req.includes("next question") || req.includes("generate next question")) {
      const { specId, previousAnswers } = ctx as {
        specId: string; previousAnswers: Array<{ question: string; answer: string }>;
      };
      const question = await generateNextQuestion(specId, previousAnswers);
      return { status: "handled", data: question };
    }

    if (req.includes("complete blind qa") || req.includes("complete blindqa")) {
      const { specId } = ctx as { specId: string };
      const result = await completeBlindQA(specId);
      return { status: "handled", data: result };
    }

    if (req.includes("is complete") || req.includes("blind qa complete")) {
      const { specId } = ctx as { specId: string };
      const complete = await isComplete(specId);
      return { status: "handled", data: { complete } };
    }

    // --- Answers ---
    if (req.includes("submit answer")) {
      const { questionId, specId, selectedOptionIndex, customText } = ctx as {
        questionId: string; specId: string; selectedOptionIndex?: number; customText?: string;
      };
      const result = await submitAnswer(questionId, specId, selectedOptionIndex, customText);
      return { status: "handled", data: result };
    }

    // --- Questions ---
    if (req.includes("create question")) {
      const { specId, text, options, sequence } = ctx as {
        specId: string; text: string; options: string[]; sequence: number;
      };
      const question = await createQuestion(specId, text, options, sequence);
      return { status: "handled", data: question };
    }

    if (req.includes("get next unanswered")) {
      const { specId } = ctx as { specId: string };
      const question = await getNextUnanswered(specId);
      return { status: "handled", data: question };
    }

    if (req.includes("get question count")) {
      const { specId } = ctx as { specId: string };
      const count = await getQuestionCount(specId);
      return { status: "handled", data: count };
    }

    if (req.includes("get questions with answers") || req.includes("get questions")) {
      const { specId } = ctx as { specId: string };
      const questions = await getQuestionsWithAnswers(specId);
      return { status: "handled", data: questions };
    }

    // --- Roles ---
    if (req.includes("create roles")) {
      const { specId, roles } = ctx as {
        specId: string; roles: Parameters<typeof createRoles>[1];
      };
      const result = await createRoles(specId, roles);
      return { status: "handled", data: result };
    }

    if (req.includes("add role members")) {
      const { roleId, members } = ctx as {
        roleId: string; members: Parameters<typeof addRoleMembers>[1];
      };
      const result = await addRoleMembers(roleId, members);
      return { status: "handled", data: result };
    }

    if (req.includes("get member user ids")) {
      const { specId } = ctx as { specId: string };
      const userIds = await getAllMemberUserIds(specId);
      return { status: "handled", data: { userIds } };
    }

    // --- Channels ---
    if (req.includes("create slack channel")) {
      const { name, skipSlack } = ctx as { name: string; skipSlack?: boolean };
      const channel = await createSlackChannel(name, { skipSlack });
      return { status: "handled", data: channel };
    }

    if (req.includes("invite members")) {
      const { slackChannelId, userIds, skipSlack } = ctx as {
        slackChannelId: string; userIds: string[]; skipSlack?: boolean;
      };
      await inviteMembers(slackChannelId, userIds, { skipSlack });
      return { status: "handled", data: null };
    }

    if (req.includes("post welcome message")) {
      const { slackChannelId, specTitle, pmDisplayName, skipSlack } = ctx as {
        slackChannelId: string; specTitle: string; pmDisplayName: string; skipSlack?: boolean;
      };
      await postWelcomeMessage(slackChannelId, specTitle, pmDisplayName, { skipSlack });
      return { status: "handled", data: null };
    }

    if (req.includes("create channel record")) {
      const { specId, slackChannelId, name, nameSuggestions, isCustomName } = ctx as {
        specId: string; slackChannelId: string; name: string;
        nameSuggestions: string[]; isCustomName: boolean;
      };
      const channel = await createChannelRecord(specId, slackChannelId, name, nameSuggestions, isCustomName);
      return { status: "handled", data: channel };
    }

    // --- LLM ---
    if (req.includes("analyze description")) {
      const { description } = ctx as { description: string };
      const result = await analyzeDescription(description);
      return { status: "handled", data: result };
    }

    if (req.includes("generate channel names")) {
      const { description, title } = ctx as { description: string; title: string };
      const names = await generateChannelNames(description, title);
      return { status: "handled", data: { names } };
    }

    // --- Maintenance ---
    if (req.includes("start session cleanup")) {
      startSessionCleanup();
      return { status: "handled", data: null };
    }

    // Outside domain — escalate
    return { status: "escalate" };
  } catch (error) {
    // Serialize AppError subclasses with code+statusCode so SpecAPI can reconstruct HTTP errors
    if (error instanceof AppError) {
      return {
        status: "handled",
        error: error.message,
        data: { errorCode: error.code, statusCode: error.statusCode },
      };
    }
    return {
      status: "handled",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default createMind({
  name: "spec_engine",
  domain: "Spec generation core: LLM calls, session state machine, Q&A, database persistence",
  keywords: ["spec", "generate", "session", "question", "answer", "llm", "drizzle", "database",
             "blindqa", "role", "channel", "slack", "validation", "markdown"],
  owns_files: ["minds/spec_engine/"],
  capabilities: [
    "create spec",
    "generate questions",
    "record answers",
    "manage sessions",
    "blind QA",
    "LLM inference",
    "database persistence",
  ],
  handle,
});
