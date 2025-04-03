"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const OLLAMA_API_URL = 'http://localhost:11434/api';
async function activate(context) {
    let chatPanel;
    // Start Chat command
    let startChatDisposable = vscode.commands.registerCommand('ollama-gemma-assistant.startChat', () => {
        if (chatPanel) {
            chatPanel.reveal(vscode.ViewColumn.One);
            return;
        }
        chatPanel = vscode.window.createWebviewPanel('ollamaChat', 'Gemma Chat', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true
        });
        chatPanel.webview.html = getWebviewContent();
        chatPanel.onDidDispose(() => {
            chatPanel = undefined;
        });
        chatPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'sendMessage') {
                try {
                    const response = await sendToOllama(message.text);
                    chatPanel?.webview.postMessage({ type: 'response', text: response });
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Failed to get response from Ollama';
                    chatPanel?.webview.postMessage({
                        type: 'error',
                        text: `Error: ${errorMessage}\n\nPlease make sure:\n1. Ollama is running\n2. The Gemma model is loaded\n3. You can access Ollama at http://localhost:11434`
                    });
                    vscode.window.showErrorMessage(errorMessage);
                }
            }
        });
    });
    // Edit Code command
    let editCodeDisposable = vscode.commands.registerCommand('ollama-gemma-assistant.editCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        const prompt = await vscode.window.showInputBox({
            prompt: 'What changes would you like to make to this code?',
            value: ''
        });
        if (!prompt) {
            return;
        }
        try {
            const response = await sendToOllama(`Please help me edit this code:\n${text}\n\nInstructions: ${prompt}`);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(editor.document.uri, selection, response);
            await vscode.workspace.applyEdit(edit);
        }
        catch (error) {
            vscode.window.showErrorMessage('Failed to get response from Ollama');
        }
    });
    context.subscriptions.push(startChatDisposable, editCodeDisposable);
}
async function sendToOllama(prompt) {
    try {
        console.log('Sending request to Ollama API...');
        const response = await axios_1.default.post(`${OLLAMA_API_URL}/generate`, {
            model: 'gemma3:4b',
            prompt: prompt,
            stream: false
        });
        console.log('Received response from Ollama:', response.data);
        return response.data.response;
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error)) {
            console.error('Axios error details:', {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status
            });
            throw new Error(`Failed to communicate with Ollama: ${error.message}`);
        }
        else {
            console.error('Unknown error:', error);
            throw error;
        }
    }
}
function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gemma Chat</title>
        <style>
            body {
                padding: 20px;
                font-family: Arial, sans-serif;
            }
            #chat-container {
                height: 400px;
                overflow-y: auto;
                border: 1px solid #ccc;
                padding: 10px;
                margin-bottom: 10px;
            }
            #input-container {
                display: flex;
                gap: 10px;
            }
            #message-input {
                flex: 1;
                padding: 8px;
            }
            button {
                padding: 8px 16px;
                background-color:rgb(91, 154, 196);
                color: white;
                border: none;
                cursor: pointer;
            }
            button:hover {
                background-color: #005999;
            }
            .message {
                margin-bottom: 10px;
                padding: 8px;
                border-radius: 4px;
            }
            .user-message {
                background-color:rgb(14, 27, 1);
            }
            .assistant-message {
                background-color:rgb(22, 2, 2);
            }
            .error-message {
                background-color: #ffebee;
                color: #c62828;
                padding: 10px;
                border-radius: 4px;
                margin: 10px 0;
            }
        </style>
    </head>
    <body>
        <div id="chat-container"></div>
        <div id="input-container">
            <input type="text" id="message-input" placeholder="Type your message...">
            <button onclick="sendMessage()">Send</button>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');

            function addMessage(text, isUser, isError = false) {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${isUser ? 'user-message' : isError ? 'error-message' : 'assistant-message'}\`;
                messageDiv.textContent = text;
                chatContainer.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function sendMessage() {
                const text = messageInput.value;
                if (text.trim()) {
                    addMessage(text, true);
                    vscode.postMessage({
                        type: 'sendMessage',
                        text: text
                    });
                    messageInput.value = '';
                }
            }

            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    sendMessage();
                }
            });

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.type === 'response') {
                    addMessage(message.text, false);
                } else if (message.type === 'error') {
                    addMessage(message.text, false, true);
                }
            });
        </script>
    </body>
    </html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map