/**
 * Question service - manages Blind QA questions
 */

import { db } from '../db/index.js';
import { questions, answers } from '../db/schema.js';
import { eq, and, notInArray, asc } from 'drizzle-orm';

export async function createQuestion(
  specId: string,
  text: string,
  options: string[],
  sequenceOrder: number
) {
  const [question] = await db
    .insert(questions)
    .values({
      specId,
      text,
      options,
      sequenceOrder,
    })
    .returning();
  
  return question;
}

export async function getNextUnanswered(specId: string) {
  // Get all answered question IDs
  const answeredIds = await db
    .select({ id: answers.questionId })
    .from(answers)
    .where(eq(answers.specId, specId));

  const answeredQuestionIds = answeredIds.map(a => a.id);

  // Find first unanswered question
  const nextQuestion = await db.query.questions.findFirst({
    where: answeredQuestionIds.length > 0
      ? and(
          eq(questions.specId, specId),
          notInArray(questions.id, answeredQuestionIds)
        )
      : eq(questions.specId, specId),
    orderBy: [asc(questions.sequenceOrder)],
  });

  return nextQuestion;
}

export async function getQuestionCount(specId: string) {
  const allQuestions = await db.query.questions.findMany({
    where: eq(questions.specId, specId),
  });

  const allAnswers = await db.query.answers.findMany({
    where: eq(answers.specId, specId),
  });

  return {
    total: allQuestions.length,
    answered: allAnswers.length,
  };
}

export async function getQuestionsWithAnswers(specId: string) {
  const questionsData = await db.query.questions.findMany({
    where: eq(questions.specId, specId),
    with: {
      answer: true,
    },
    orderBy: [asc(questions.sequenceOrder)],
  });

  return questionsData;
}
