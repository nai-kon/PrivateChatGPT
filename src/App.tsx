import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { Convert } from "easy-currencies";
import OpenAI from "openai";
import { useEffect, useRef, useState } from "react";
import MarkdownRenderer from './CodeBlock.tsx';
import { apikey } from "./openai-key.ts";


const localStrageKey = "chat-history";
// pricing per token of GPT-4o (https://openai.com/api/pricing/)
interface GptModel {
  [name: string]: { input_doller_per_token: number; output_doller_per_token: number };
}
const gptmodels:GptModel = {
  "gpt-4o-mini": { input_doller_per_token: 0.15 / 1000000, output_doller_per_token: 0.6 / 1000000 },
  "gpt-4o": { input_doller_per_token: 5 / 1000000, output_doller_per_token: 15 / 1000000 },
};

const openai = new OpenAI({
  apiKey: apikey, // This is the default and can be omitted
  dangerouslyAllowBrowser: true,
});

function App() {
  const [query, setQuery] = useState<string>("");
  const [streamAnswer, setStreamAnswer] = useState<string>("");
  const [gptmodel, setGptModel] = useState<string>("gpt-4o-mini");
  const [chats, setChats] = useState({
    list: [{ title: "", chat: [{ role: "", content: "" , model: "", cost: 0}] }],
  });
  const messageEndRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState<number>(0);

  // chat履歴の読み込み
  useEffect(() => {
    const chatHistory = JSON.parse(
      localStorage.getItem(localStrageKey) || `{"list":[]}`
    );
    setChats(chatHistory);
    // fetch("./chat-history.json")
    //   .then((res) => res.json())
    //   .then((data) => setChats(data));
  }, []);

  // 最下部までスクロール
  useEffect(() => {
    scrollToLatest();
  }, [streamAnswer, activeIdx, query]);

  const handleModelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const model = event.target.value;
    setGptModel(model);
  }

  const addNewChat = () => {
    setChats({
      list: [{ title: "New Chat", chat: [] }, ...chats["list"]],
    });
    setActiveIdx(0);
  };

  const saveChat = () => {
    // ローカルストレージに保存
    localStorage.setItem(localStrageKey, JSON.stringify(chats));
  };

  // サイドバーの項目削除
  const delIndex = (idx: number) => {
    if (!window.confirm("Delete Chat?")) return;

    const curchat = { ...chats };
    curchat.list.splice(idx, 1);
    setChats(curchat);

    // インデックス再選択
    const newidx = curchat.list.length > idx ? idx : curchat.list.length - 1;
    setActiveIdx(newidx);

    // 保存
    saveChat();
  };

  const scrollToLatest = () => {
    messageEndRef?.current?.scrollIntoView({ behavior: "smooth" });
  };

  const postQuery = async () => {
    const curchat = { ...chats };
    curchat.list[activeIdx].chat.push({ role: "user", content: query, model: gptmodel, cost: 0});
    setChats(curchat);
    setQuery("");

    // token量を考慮し会話履歴を過去9件に絞ってリクエスト
    const last10chats = chats.list[activeIdx].chat.slice(-9);
    const stream = await openai.chat.completions.create({
      model: gptmodel,
      messages: last10chats as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
      stream_options: {
        include_usage: true
      }
    });

    // レスポンス
    let cost = 0
    let answer = "";
    for await (const chunk of stream) {
      answer += chunk.choices[0]?.delta?.content || "";
      setStreamAnswer(answer);

      if(chunk.usage !== null){
        // 現在の為替レートでAPIコストを算出
        cost = gptmodels[gptmodel].input_doller_per_token * (chunk.usage?.prompt_tokens ?? 0) + 
              gptmodels[gptmodel].output_doller_per_token * (chunk.usage?.completion_tokens ?? 0);
        cost = await Convert(cost).from("USD").to("JPY");
      }
    }
    curchat.list[activeIdx].chat.push({role: "assistant", content: answer, model: gptmodel, cost: cost });

    setStreamAnswer("");
    setChats(curchat);

    // チャット名がNew Chatの場合はタイトルを付ける
    if (curchat.list[activeIdx].title === "New Chat") {
      await setChatTitle();
    }
    saveChat();
  };

  const setChatTitle = async () => {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content:
            "以下の文章のタイトルを日本語で最大10文字で簡潔に付けてください。括弧は不要です。\n" +
            query,
        },
      ],
    });

    const title = completion.choices[0].message.content;
    if (title) {
      const curchat = { ...chats };
      curchat.list[activeIdx].title = title;
      setChats(curchat);
    }
  };

  const enterSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key == "Enter" && !e.shiftKey) {
      postQuery();
      e.preventDefault();
    }
  };

  return (
    <div className="flex h-screen overflow-hidden text-white">
      {/* sidebar */}
      <div className="bg-slate-800 overflow-auto w-52">
        <div className="italic text-center m-3 text-xl">Private ChatGPT</div>      
        {/* gpt-model select */}
        <select value={gptmodel} onChange={handleModelChange} className="flex mx-auto bg-slate-800 text-center mb-5">
          {Object.keys(gptmodels).map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
        <ul>
          {/* newchat */}
          <li
            className="flex p-3 text-green-500 hover:bg-slate-600 hover:cursor-pointer"
            onClick={() => addNewChat()}
          >
            <AddIcon /> 新しいチャット
          </li>

          {/* chat histories */}
          {chats.list.reverse().map((value, key) => {
            return (
              <li
                key={key}
                className={`flex p-3 ${
                  key === activeIdx
                    ? "bg-slate-600"
                    : "hover:cursor-pointer hover:bg-slate-600"
                }`}
                onClick={() => setActiveIdx(key)}
              >
                {value.title}
                <DeleteOutlineIcon
                  className="p-1 ml-auto hover:text-red-500 hover:cursor-pointer hover:p-0"
                  onClick={() => delIndex(key)}
                />
              </li>
            );
          })}
        </ul>
      </div>
      
      {/* chat UI */}
      <div className="flex-1 flex flex-col bg-slate-600">
        <div className="flex-1 overflow-auto">
          {chats.list[activeIdx]?.chat.map((value, key) => {
            return (
              <div key={key} className="m-2 rounded-xl bg-slate-700">
                <div className="text-sm p-2">
                  {value.role === "assistant" ? `🧠 ${value.model}` : "💁 You"}
                </div>
                {/* <ReactMarkdown className="p-2">{value.content}</ReactMarkdown> */}
                <div className="p-2">
                  <MarkdownRenderer markdown={value.content}/>
                  <div className="p-2 text-red-400">{value.cost > 0 ? `[API料金: ${(value.cost).toFixed(2)}円]` : ""}</div>            
                </div>
              </div>
            );
          })}
          {/* streamの回答をsetChatsしても描画されないので(全チャット履歴につき更新差分チェックが大変だから？)、回答用に専用のdivを設けます
          streamが終われば回答をsetchatsして、こちらはinvisibleにする */}
          <div
            className={`rounded-xl m-2 bg-slate-700 ${
              streamAnswer.length === 0 ? "hidden" : ""
            }`}
          >
            <div className="text-sm p-2">{"🧠 " + gptmodel}</div>
            <div className="p-2"><MarkdownRenderer markdown={streamAnswer}/></div>
          </div>
          {/* 自動スクロール用のダミー要素 */}
          <div id="lastelment" ref={messageEndRef} />
        </div>
        <textarea
          className="bg-slate-200 rounded-lg p-1 m-2 text-black resize-none"
          value={query}
          rows={3}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={enterSubmit}
          placeholder="ここに入力... Enterで送信"
        />
      </div>
    </div>
  );
}

export default App;
