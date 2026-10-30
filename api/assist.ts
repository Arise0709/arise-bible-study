/**
 * Optional AI study assistant (Vercel serverless function).
 *
 * Off unless ANTHROPIC_API_KEY is set in the Vercel project. The browser never sees the key.
 * The model receives only the reader's study materials and must cite them; the client then
 * verifies every quotation, reference and Strong's number before showing the result.
 */
import Anthropic from '@anthropic-ai/sdk'

const TASKS: Record<string, string> = {
  organize: 'Organize the reader\'s observations into clear groups (repeated words, commands, promises, contrasts, questions, connections). Do not add new observations that the materials do not support.',
  questions: 'Suggest 6 to 10 study or discussion questions that send the reader back into the passage. Mix observation, interpretation, and application questions.',
  summarize: 'Summarize the reader\'s saved notes and conclusions faithfully. Keep their meaning; do not add new claims.',
  outline: 'Draft a teaching outline (introduction, 2 to 4 main points with subpoints, application, conclusion) built only from the reader\'s study. Each point should name the verse it comes from.',
}

const SYSTEM = `You help a Bible student organize their own Bible study. Quote Scripture only in the translation used in the study materials. You are a study aid, not an authority.

Rules you must follow:
1. Use only the materials in the STUDY MATERIALS block: the Bible verses given, the Strong's entries given, and the reader's notes. Do not use outside commentaries or claim historical facts that are not in the materials.
2. Never invent or paraphrase a Scripture quotation. If you quote Scripture, put it in the "quotes" array with its reference, copying the words exactly as given in the materials. Do not put Scripture quotations in the body text.
3. Only mention Strong's numbers that appear in the materials.
4. Keep interpretation separate from Scripture. When you interpret, say so ("This may mean...", "One reading is..."). When the passage allows more than one reasonable reading, or the materials do not settle a question, list it under "uncertainties".
5. List every passage you rely on in "citations" using OSIS ids like John.3.16 or Rom.5.8.
6. Write plainly, in short paragraphs, without em dashes.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections', 'citations', 'strongs', 'quotes', 'uncertainties'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'body'],
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
      },
    },
    citations: { type: 'array', items: { type: 'string' } },
    strongs: { type: 'array', items: { type: 'string' } },
    quotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'text'],
        properties: { ref: { type: 'string' }, text: { type: 'string' } },
      },
    },
    uncertainties: { type: 'array', items: { type: 'string' } },
  },
} as const

export async function GET() {
  return Response.json({ configured: !!process.env.ANTHROPIC_API_KEY })
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'The AI assistant is not configured on this deployment. Add ANTHROPIC_API_KEY in the Vercel project settings.' }, { status: 501 })
  }
  let body: { task?: string; materials?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 })
  }
  const task = TASKS[body.task ?? '']
  const materials = String(body.materials ?? '')
  if (!task) return Response.json({ error: 'Unknown task.' }, { status: 400 })
  if (!materials.trim()) return Response.json({ error: 'There is nothing in this study yet for the assistant to work with.' }, { status: 400 })
  if (materials.length > 120_000) return Response.json({ error: 'This study is too large to send in one request. Try summarizing one section at a time.' }, { status: 413 })

  const client = new Anthropic()
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `<study_materials>\n${materials}\n</study_materials>\n\nTask: ${task}`,
        },
      ],
    })
    if (response.stop_reason === 'refusal') {
      return Response.json({ error: 'The assistant declined this request. Try rephrasing or narrowing it.' }, { status: 422 })
    }
    if (response.stop_reason === 'max_tokens') {
      return Response.json({ error: 'The response was cut off. Try a smaller section.' }, { status: 422 })
    }
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const parsed = JSON.parse(text)
    return Response.json({ result: parsed, model: response.model })
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: 'The assistant is busy. Wait a minute and try again.' }, { status: 429 })
    if (error instanceof Anthropic.AuthenticationError) return Response.json({ error: 'The API key on this deployment was rejected.' }, { status: 502 })
    if (error instanceof Anthropic.APIError) return Response.json({ error: `The AI service returned an error (${error.status}).` }, { status: 502 })
    if (error instanceof SyntaxError) return Response.json({ error: 'The assistant returned an unreadable answer. Try again.' }, { status: 502 })
    return Response.json({ error: 'Could not reach the AI service.' }, { status: 502 })
  }
}
