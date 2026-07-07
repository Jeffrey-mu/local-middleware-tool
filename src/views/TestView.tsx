import type { FormEvent } from 'react'
import { Send, Square } from 'lucide-react'
import { Button } from '../components/ui/button'
import type { ChatMessage } from '../types'

type TestViewProps = {
  chatInput: string
  chatModel: string
  chatStream: boolean
  chatRunning: boolean
  chatMessages: ChatMessage[]
  modelOptions: string[]
  onChatInputChange: (value: string) => void
  onChatModelChange: (value: string) => void
  onToggleStream: () => void
  onSendTestMessage: (event: FormEvent<HTMLFormElement>) => void
  onStopChat: () => void
}

export function TestView({ chatInput, chatModel, chatStream, chatRunning, chatMessages, modelOptions, onChatInputChange, onChatModelChange, onToggleStream, onSendTestMessage, onStopChat }: TestViewProps) {
  return (
<section className="panel chat-panel">
            <div className="panel-title">
              <div>
                <p className="eyebrow">测试</p>
                <h3>对话窗口</h3>
              </div>
              <div className="chat-controls">
                <input aria-label="测试模型" list="gateway-models" value={chatModel} onChange={(event) => onChatModelChange(event.target.value)} />
                <datalist id="gateway-models">
                  {modelOptions.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                <Button variant={chatStream ? 'default' : 'secondary'} type="button" onClick={() => onToggleStream()}>
                  {chatStream ? '流式' : '非流式'}
                </Button>
              </div>
            </div>

            <div className="chat-window">
              {chatMessages.map((message) => (
                <article className={`chat-message ${message.role} ${message.state ?? ''}`} key={message.id}>
                  <span>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'AI' : '系统'}</span>
                  <p>{message.content}</p>
                </article>
              ))}
            </div>

            <form className="chat-composer" onSubmit={onSendTestMessage}>
              <textarea
                placeholder="输入一条测试消息"
                value={chatInput}
                onChange={(event) => onChatInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              {chatRunning ? (
                <Button type="button" onClick={onStopChat}>
                  <Square size={16} />
                  停止
                </Button>
              ) : (
                <Button type="submit" disabled={!chatInput.trim() || !chatModel.trim()}>
                  <Send size={16} />
                  发送
                </Button>
              )}
            </form>
          </section>
  )
}
