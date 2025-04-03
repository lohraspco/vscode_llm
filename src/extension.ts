import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const OLLAMA_API_URL = 'http://localhost:11434/api';

interface ChatMessage {
    text: string;
    isUser: boolean;
    isError: boolean;
    time: string;
}

interface ChatTopic {
    id: string;
    name: string;
    messages: ChatMessage[];
    createdAt: string;
}

interface OllamaResponse {
    response: string;
    done: boolean;
}

export async function activate(context: vscode.ExtensionContext) {
    let chatPanel: vscode.WebviewPanel | undefined;
    let topics: ChatTopic[] = [];
    const storagePath = path.join(context.globalStorageUri.fsPath, 'chats.json');

    // Create storage directory if it doesn't exist
    if (!fs.existsSync(context.globalStorageUri.fsPath)) {
        fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    }

    // Load saved chats
    try {
        if (fs.existsSync(storagePath)) {
            const data = fs.readFileSync(storagePath, 'utf8');
            topics = JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading chats:', error);
    }

    // Create sidebar view
    const chatProvider = new ChatProvider(topics);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('ollama-gemma-chats', chatProvider)
    );

    // Register open chat command
    let openChatDisposable = vscode.commands.registerCommand('ollama-gemma-assistant.openChat', (topic: ChatTopic) => {
        if (chatPanel) {
            chatPanel.reveal(vscode.ViewColumn.One);
            chatPanel.webview.postMessage({ type: 'switchTopic', topic });
        } else {
            vscode.commands.executeCommand('ollama-gemma-assistant.startChat');
        }
    });

    // Start Chat command
    let startChatDisposable = vscode.commands.registerCommand('ollama-gemma-assistant.startChat', () => {
        if (chatPanel) {
            chatPanel.reveal(vscode.ViewColumn.One);
            return;
        }

        chatPanel = vscode.window.createWebviewPanel(
            'ollamaChat',
            'Gemma Chat',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        chatPanel.webview.html = getWebviewContent(topics);

        chatPanel.onDidDispose(() => {
            chatPanel = undefined;
        });

        chatPanel.webview.onDidReceiveMessage(async message => {
            if (message.type === 'sendMessage') {
                try {
                    const response = await sendToOllama(message.text);
                    chatPanel?.webview.postMessage({ type: 'response', text: response });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Failed to get response from Ollama';
                    chatPanel?.webview.postMessage({ 
                        type: 'error', 
                        text: `Error: ${errorMessage}\n\nPlease make sure:\n1. Ollama is running\n2. The Gemma model is loaded\n3. You can access Ollama at http://localhost:11434`
                    });
                    vscode.window.showErrorMessage(errorMessage);
                }
            } else if (message.type === 'saveChat') {
                const { topicId, messages } = message;
                const topic = topics.find(t => t.id === topicId);
                if (topic) {
                    topic.messages = messages;
                    saveChats(topics, storagePath);
                    chatProvider.refresh();
                }
            } else if (message.type === 'createTopic') {
                const { name } = message;
                const newTopic: ChatTopic = {
                    id: Date.now().toString(),
                    name,
                    messages: [],
                    createdAt: new Date().toISOString()
                };
                topics.push(newTopic);
                saveChats(topics, storagePath);
                chatProvider.refresh();
                chatPanel?.webview.postMessage({ 
                    type: 'topicCreated', 
                    topic: newTopic 
                });
            } else if (message.type === 'resetChat') {
                const { topicId } = message;
                const topic = topics.find(t => t.id === topicId);
                if (topic) {
                    topic.messages = [];
                    saveChats(topics, storagePath);
                    chatProvider.refresh();
                    chatPanel?.webview.postMessage({ 
                        type: 'chatReset', 
                        topicId 
                    });
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
        } catch (error) {
            vscode.window.showErrorMessage('Failed to get response from Ollama');
        }
    });

    context.subscriptions.push(startChatDisposable, editCodeDisposable, openChatDisposable);
}

class ChatProvider implements vscode.TreeDataProvider<ChatTopic> {
    private _onDidChangeTreeData: vscode.EventEmitter<ChatTopic | undefined | null | void> = new vscode.EventEmitter<ChatTopic | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ChatTopic | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private topics: ChatTopic[]) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ChatTopic): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(element.name);
        treeItem.id = element.id;
        treeItem.command = {
            command: 'ollama-gemma-assistant.openChat',
            title: 'Open Chat',
            arguments: [element]
        };
        return treeItem;
    }

    getChildren(): ChatTopic[] {
        return this.topics;
    }
}

function saveChats(topics: ChatTopic[], storagePath: string) {
    try {
        fs.writeFileSync(storagePath, JSON.stringify(topics, null, 2));
    } catch (error) {
        console.error('Error saving chats:', error);
    }
}

async function sendToOllama(prompt: string): Promise<string> {
    try {
        console.log('Sending request to Ollama API...');
        const response = await axios.post<OllamaResponse>(`${OLLAMA_API_URL}/generate`, {
            model: 'gemma3:4b',
            prompt: prompt,
            stream: false
        });
        console.log('Received response from Ollama:', response.data);
        return response.data.response;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('Axios error details:', {
                message: error.message,
                response: error.response?.data,
                status: error.response?.status
            });
            throw new Error(`Failed to communicate with Ollama: ${error.message}`);
        } else {
            console.error('Unknown error:', error);
            throw error;
        }
    }
}

function getWebviewContent(topics: ChatTopic[]) {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Gemma Chat</title>
        <style>
            :root {
                --primary-color: #2563eb;
                --primary-hover: #1d4ed8;
                --bg-color: #ffffff;
                --text-color: #000000;
                --chat-bg: #ffffff;
                --user-message-bg:rgb(234, 252, 232);
                --assistant-message-bg:rgb(184, 213, 243);
                --error-bg: #fee2e2;
                --error-text: #000000;
                --border-color: #e2e8f0;
                --tab-active: #2563eb;
                --tab-inactive: #000000;
                --input-bg: #000000;
                --input-text: #ffffff;
                --input-placeholder: #9ca3af;
                --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
                --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
                --message-time-color: #000000;
            }

            body {
                padding: 0;
                margin: 0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                background-color: var(--bg-color);
                color: var(--text-color);
                height: 100vh;
                display: flex;
                flex-direction: column;
            }

            .container {
                display: flex;
                flex-direction: column;
                height: 100vh;
                padding: 16px;
                box-sizing: border-box;
                max-width: 1200px;
                margin: 0 auto;
                width: 100%;
            }

            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                background-color: var(--chat-bg);
                border-radius: 12px;
                margin-bottom: 16px;
                box-shadow: var(--shadow-sm);
            }

            .header h1 {
                margin: 0;
                font-size: 1.5rem;
                color: var(--text-color);
                font-weight: 700;
            }

            .header-actions {
                display: flex;
                gap: 8px;
            }

            .reset-btn {
                padding: 8px 16px;
                background-color: var(--error-bg);
                color: var(--error-text);
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
            }

            .reset-btn:hover {
                background-color: #fecaca;
            }

            .topic-selector {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
                padding: 8px;
                background-color: var(--chat-bg);
                border-radius: 12px;
                box-shadow: var(--shadow-sm);
            }

            .topic-select {
                flex: 1;
                padding: 8px;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                background-color: var(--input-bg);
                color: var(--input-text);
            }

            .new-topic-btn {
                padding: 8px 16px;
                background-color: var(--primary-color);
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
            }

            .new-topic-btn:hover {
                background-color: var(--primary-hover);
            }

            #chat-container {
                flex: 1;
                overflow-y: auto;
                padding: 24px;
                background-color: var(--chat-bg);
                border-radius: 12px;
                margin-bottom: 16px;
                box-shadow: var(--shadow-sm);
            }

            #input-container {
                display: flex;
                gap: 12px;
                padding: 16px;
                background-color: var(--chat-bg);
                border-radius: 12px;
                box-shadow: var(--shadow-md);
            }

            #message-input {
                flex: 1;
                padding: 12px 16px;
                border: 1px solid var(--border-color);
                border-radius: 8px;
                font-size: 14px;
                outline: none;
                transition: all 0.2s ease;
                background-color: var(--input-bg);
                color: var(--input-text);
            }

            #message-input::placeholder {
                color: var(--input-placeholder);
            }

            #message-input:focus {
                border-color: var(--primary-color);
                box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
            }

            button {
                padding: 12px 24px;
                background-color: var(--primary-color);
                color: white;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s ease;
            }

            button:hover {
                background-color: var(--primary-hover);
                transform: translateY(-1px);
            }

            .message {
                margin-bottom: 16px;
                padding: 16px;
                border-radius: 12px;
                max-width: 85%;
                box-shadow: var(--shadow-sm);
                position: relative;
            }

            .user-message {
                background-color: var(--user-message-bg);
                margin-left: auto;
                border-bottom-right-radius: 4px;
            }

            .assistant-message {
                background-color: var(--assistant-message-bg);
                margin-right: auto;
                border-bottom-left-radius: 4px;
            }

            .error-message {
                background-color: var(--error-bg);
                color: var(--error-text);
                padding: 16px;
                border-radius: 12px;
                margin: 16px 0;
                max-width: 100%;
                border: 1px solid rgba(153, 27, 27, 0.1);
            }

            .message-time {
                font-size: 12px;
                color: var(--message-time-color);
                margin-top: 8px;
                text-align: right;
            }

            .typing-indicator {
                display: flex;
                gap: 4px;
                padding: 16px;
                background-color: var(--assistant-message-bg);
                border-radius: 12px;
                margin-right: auto;
                width: fit-content;
                box-shadow: var(--shadow-sm);
            }

            .typing-dot {
                width: 8px;
                height: 8px;
                background-color: var(--primary-color);
                border-radius: 50%;
                animation: typing 1s infinite;
            }

            .typing-dot:nth-child(2) {
                animation-delay: 0.2s;
            }

            .typing-dot:nth-child(3) {
                animation-delay: 0.4s;
            }

            @keyframes typing {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-4px); }
            }

            /* Scrollbar styling */
            ::-webkit-scrollbar {
                width: 8px;
                height: 8px;
            }

            ::-webkit-scrollbar-track {
                background: var(--bg-color);
                border-radius: 4px;
            }

            ::-webkit-scrollbar-thumb {
                background: var(--border-color);
                border-radius: 4px;
            }

            ::-webkit-scrollbar-thumb:hover {
                background: var(--tab-inactive);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Gemma Assistant</h1>
                <div class="header-actions">
                    <button class="reset-btn" onclick="resetChat()">Reset Chat</button>
                </div>
            </div>
            <div class="topic-selector">
                <select class="topic-select" id="topic-select">
                    ${topics.map(topic => `<option value="${topic.id}">${topic.name}</option>`).join('')}
                </select>
                <button class="new-topic-btn" onclick="createNewTopic()">New Topic</button>
            </div>
            <div id="chat-container"></div>
            <div id="input-container">
                <input type="text" id="message-input" placeholder="Type your message...">
                <button onclick="sendMessage()">Send</button>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');
            const topicSelect = document.getElementById('topic-select');
            let currentTopicId = topicSelect.value;
            let messages = ${JSON.stringify(topics.reduce((acc, topic) => {
                acc[topic.id] = topic.messages;
                return acc;
            }, {}))};

            function formatTime() {
                return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            function addMessage(text, isUser, isError = false) {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${isUser ? 'user-message' : isError ? 'error-message' : 'assistant-message'}\`;
                
                const messageContent = document.createElement('div');
                messageContent.textContent = text;
                messageDiv.appendChild(messageContent);

                const timeDiv = document.createElement('div');
                timeDiv.className = 'message-time';
                timeDiv.textContent = formatTime();
                messageDiv.appendChild(timeDiv);

                chatContainer.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;

                messages[currentTopicId].push({ text, isUser, isError, time: formatTime() });
                saveMessages();
            }

            function saveMessages() {
                vscode.postMessage({
                    type: 'saveChat',
                    topicId: currentTopicId,
                    messages: messages[currentTopicId]
                });
            }

            function showTypingIndicator() {
                const indicator = document.createElement('div');
                indicator.className = 'typing-indicator';
                indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
                chatContainer.appendChild(indicator);
                chatContainer.scrollTop = chatContainer.scrollHeight;
                return indicator;
            }

            function removeTypingIndicator(indicator) {
                indicator.remove();
            }

            function switchTopic(topicId) {
                currentTopicId = topicId;
                chatContainer.innerHTML = '';
                messages[topicId].forEach(msg => {
                    addMessage(msg.text, msg.isUser, msg.isError);
                });
            }

            function resetChat() {
                if (confirm('Are you sure you want to reset this chat? This action cannot be undone.')) {
                    vscode.postMessage({
                        type: 'resetChat',
                        topicId: currentTopicId
                    });
                }
            }

            function createNewTopic() {
                const name = prompt('Enter topic name:');
                if (!name) return;

                vscode.postMessage({
                    type: 'createTopic',
                    name
                });
            }

            topicSelect.addEventListener('change', (e) => {
                switchTopic(e.target.value);
            });

            function sendMessage() {
                const text = messageInput.value;
                if (text.trim()) {
                    addMessage(text, true);
                    const typingIndicator = showTypingIndicator();
                    
                    vscode.postMessage({
                        type: 'sendMessage',
                        text: text
                    });
                    
                    messageInput.value = '';
                    return typingIndicator;
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
                    removeTypingIndicator(document.querySelector('.typing-indicator'));
                    addMessage(message.text, false);
                } else if (message.type === 'error') {
                    removeTypingIndicator(document.querySelector('.typing-indicator'));
                    addMessage(message.text, false, true);
                } else if (message.type === 'topicCreated') {
                    const option = document.createElement('option');
                    option.value = message.topic.id;
                    option.textContent = message.topic.name;
                    topicSelect.appendChild(option);
                    topicSelect.value = message.topic.id;
                    switchTopic(message.topic.id);
                } else if (message.type === 'chatReset') {
                    chatContainer.innerHTML = '';
                    messages[message.topicId] = [];
                } else if (message.type === 'switchTopic') {
                    const topic = message.topic;
                    if (!topicSelect.querySelector(\`option[value="\${topic.id}"]\`)) {
                        const option = document.createElement('option');
                        option.value = topic.id;
                        option.textContent = topic.name;
                        topicSelect.appendChild(option);
                    }
                    topicSelect.value = topic.id;
                    switchTopic(topic.id);
                }
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {} 