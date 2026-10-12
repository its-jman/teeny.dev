import {experimental_transcribe as transcribe} from 'ai'
import {createWorkersAI} from 'workers-ai-provider'

export const TRANSCRIPTION_MODEL = '@cf/openai/whisper-large-v3-turbo'

export async function transcribeAudio(env: Env, audio: Uint8Array) {
	const start = performance.now()
	const result = await transcribe({
		model: createWorkersAI({binding: env.AI}).transcription(TRANSCRIPTION_MODEL),
		audio,
	})
	return {text: result.text.trim(), ms: performance.now() - start}
}
