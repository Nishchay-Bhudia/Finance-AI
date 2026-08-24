import { ollama } from 'ai-sdk-ollama';

export const model = ollama('qwen2.5:3b', {
	think: false,
	options: {
		num_predict: 500,
		// Ollama defaults to a 2048-token context window no matter what the
		// model itself supports, which was silently truncating our prompts
		// (system instructions + tool schemas + search results) and making
		// the model forget it had tools to call. Give it more room.
		num_ctx: 8192,
	},
});