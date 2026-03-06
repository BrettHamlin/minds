/**
 * LLM service using OpenRouter with Claude Sonnet 4.5
 */

import OpenAI from 'openai';
import { LLMError } from '../errors.js';

const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = 'anthropic/claude-sonnet-4-5';

interface AnalysisResult {
  title: string;
  roles: Array<{
    name: string;
    rationale: string;
  }>;
  complexityScore: number;
  estimatedQuestions: number;
}

export async function analyzeDescription(description: string): Promise<AnalysisResult> {
  const systemPrompt = `You are an AI assistant that analyzes feature descriptions and determines:
1. A concise title for the feature (max 50 characters)
2. Required team roles with rationales
3. Complexity score (1-10, where 1=trivial, 10=very complex)
4. Estimated number of clarifying questions needed (5-20)

Return your analysis as JSON matching this schema:
{
  "title": "string",
  "roles": [{"name": "string", "rationale": "string"}],
  "complexityScore": number,
  "estimatedQuestions": number
}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this feature:\n\n${description}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const result = JSON.parse(content) as AnalysisResult;
    
    // Validate response structure
    if (!result.title || !result.roles || !result.complexityScore || !result.estimatedQuestions) {
      throw new Error('Invalid response structure from LLM');
    }

    // Clamp values to valid ranges
    result.complexityScore = Math.max(1, Math.min(10, result.complexityScore));
    result.estimatedQuestions = Math.max(5, Math.min(20, result.estimatedQuestions));

    return result;
  } catch (error: any) {
    console.error('LLM analysis error:', error);
    throw new LLMError(`Failed to analyze feature description: ${error.message}`, {
      originalError: error.message,
    });
  }
}

export async function generateChannelNames(description: string, title: string): Promise<string[]> {
  const systemPrompt = `Generate exactly 5 Slack channel name suggestions for this feature.
Rules:
- Lowercase only
- Max 80 characters
- Use hyphens to separate words
- Start with a letter or number
- Be descriptive and concise

Return as JSON array: ["name-1", "name-2", "name-3", "name-4", "name-5"]`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Feature title: ${title}\n\nDescription: ${description}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const result = JSON.parse(content);
    const suggestions = result.suggestions || result.names || result;

    if (!Array.isArray(suggestions) || suggestions.length !== 5) {
      throw new Error('LLM did not return exactly 5 channel names');
    }

    return suggestions.map((name: string) => name.toLowerCase().slice(0, 80));
  } catch (error: any) {
    console.error('LLM channel name generation error:', error);
    throw new LLMError(`Failed to generate channel names: ${error.message}`, {
      originalError: error.message,
    });
  }
}

// --- Blind QA Functions ---

interface QuestionResult {
  text: string;
  options: string[];
}

export async function generateQuestion(
  specDescription: string,
  previousQAs: Array<{ question: string; answer: string }>,
  questionNumber: number,
  totalQuestions: number
): Promise<QuestionResult> {
  const systemPrompt = `You are conducting a Blind QA session to clarify a feature specification.
Generate the next clarifying question based on the feature description and previous Q&A.

Rules:
- Ask specific, actionable questions
- Provide 3-5 multiple choice options
- Always include "Other" as the last option
- Adapt depth based on question ${questionNumber}/${totalQuestions}
- Focus on uncovering edge cases, constraints, and user expectations

Return JSON: {"text": "question text", "options": ["option1", "option2", "option3", "Other"]}`;

  const qaContext = previousQAs.length > 0
    ? `\n\nPrevious Q&A:\n${previousQAs.map((qa, i) => `${i + 1}. Q: ${qa.question}\n   A: ${qa.answer}`).join('\n')}`
    : '';

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Feature: ${specDescription}${qaContext}\n\nGenerate question ${questionNumber} of ${totalQuestions}:` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    const result = JSON.parse(content) as QuestionResult;

    if (!result.text || !Array.isArray(result.options) || result.options.length < 2) {
      throw new Error('Invalid question format from LLM');
    }

    // Ensure "Other" is the last option
    const filteredOptions = result.options.filter(opt => opt.toLowerCase() !== 'other');
    result.options = [...filteredOptions, 'Other'];

    return result;
  } catch (error: any) {
    console.error('LLM question generation error:', error);
    throw new LLMError(`Failed to generate question: ${error.message}`, {
      originalError: error.message,
    });
  }
}

export async function generateSpec(
  specDescription: string,
  allQAs: Array<{ question: string; answer: string }>,
  roles: Array<{ name: string; rationale: string }>
): Promise<string> {
  const systemPrompt = `You are generating a comprehensive feature specification in Markdown format.
Use the feature description and all Q&A responses to create a complete spec with:
- Overview/Context
- Functional Requirements
- Non-Functional Requirements
- User Stories
- Edge Cases
- Technical Considerations
- Team Roles and Responsibilities

Be specific, actionable, and comprehensive.`;

  const qaText = allQAs.map((qa, i) => `${i + 1}. **Q:** ${qa.question}\n   **A:** ${qa.answer}`).join('\n\n');
  const rolesText = roles.map(r => `- **${r.name}**: ${r.rationale}`).join('\n');

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate a specification for:\n\n**Feature:** ${specDescription}\n\n**Team Roles:**\n${rolesText}\n\n**Clarification Q&A:**\n${qaText}`,
        },
      ],
      max_tokens: 4000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from LLM');
    }

    return content;
  } catch (error: any) {
    console.error('LLM spec generation error:', error);
    throw new LLMError(`Failed to generate specification: ${error.message}`, {
      originalError: error.message,
    });
  }
}
