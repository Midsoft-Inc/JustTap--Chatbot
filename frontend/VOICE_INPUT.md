# Genie voice input

Click the existing microphone to start listening. Genie displays an "I'm listening..."
status, converts speech to text using the browser's SpeechRecognition API, and places
the recognized text into the existing chat input. Listening stops automatically when
speech ends, or immediately when the microphone is clicked again.

Language mapping:
- English: en-IN
- Hindi: hi-IN
- Marathi: mr-IN

The recognized text continues through the existing CSV/RAG retrieval flow.
No LLM, MongoDB, or Redis is added.
