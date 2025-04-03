# Gemma Assistant for VS Code

A Visual Studio Code extension that integrates the Gemma model through Ollama for intelligent chat and code editing assistance.

## Features

- Chat with Gemma AI directly in VS Code
- Create and manage multiple chat topics
- Edit code with AI assistance
- Persistent chat history
- Modern and intuitive UI
- Markdown support in chat messages

## Requirements

- Visual Studio Code 1.85.0 or higher
- [Ollama](https://ollama.ai/) installed and running locally
- The Gemma model loaded in Ollama (`ollama pull gemma3:4b`)

## Installation

1. Install the extension from the VS Code Marketplace
2. Install Ollama from [ollama.ai](https://ollama.ai/)
3. Pull the Gemma model:
   ```bash
   ollama pull gemma3:4b
   ```

## Usage

1. Click the Gemma Assistant icon in the activity bar to open the chat view
2. Create a new topic or select an existing one
3. Start chatting with Gemma
4. Use the "Edit Code with Gemma" command to get AI assistance with code editing

## Extension Settings

This extension contributes the following settings:

* `ollama-gemma-assistant.model`: The Ollama model to use (default: "gemma3:4b")
* `ollama-gemma-assistant.apiUrl`: The Ollama API URL (default: "http://localhost:11434")

## Known Issues

- Requires Ollama to be running locally
- Requires the Gemma model to be loaded in Ollama

## Release Notes

### 0.0.1

Initial release of Gemma Assistant for VS Code.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the MIT License - see the LICENSE file for details. 