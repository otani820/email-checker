// Netlify Function: Gemini API版
// このファイルはサーバー側で実行されるため、APIキーがブラウザに見えることはありません。
// Netlifyの管理画面で環境変数 GEMINI_API_KEY を設定してください。
// （Google AI Studio: https://aistudio.google.com で無料枠のキーを発行できます）

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "GEMINI_API_KEY is not set in Netlify environment variables." }),
    };
  }

  let text;
  try {
    const body = JSON.parse(event.body);
    text = body.text;
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  if (!text || typeof text !== "string") {
    return { statusCode: 400, body: JSON.stringify({ error: "text is required" }) };
  }

  const systemPrompt = `あなたは日本のビジネスメールの丁寧さを判定する専門家です。与えられたメール本文を分析し、指定されたJSON形式で出力してください。

出力形式:
{
  "score": 0から100の整数（100が最も丁寧、0が最も失礼・雑）,
  "verdict_short": "判定を表す漢字2〜4文字（例: 丁寧, 普通, 失礼, 硬すぎ, カジュアル）",
  "verdict_label": "判定を表す短いラベル（例: ちょうどよい, やや失礼, 丁寧すぎる, カジュアルすぎる）",
  "summary": "全体的な印象を1〜2文で",
  "flags": [
    {
      "phrase": "原文から抜き出した気になる表現（15文字程度まで）",
      "type": "casual または stiff または rude",
      "note": "何が問題か、1文で",
      "suggestion": "言い換え案の表現"
    }
  ],
  "improved_email": "文面全体を適切な丁寧さに書き直した完全な本文"
}

flagsは最大4件まで。該当箇所がなければ空配列でよい。`;

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: text }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { statusCode: response.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await response.json();
    const raw =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0]
        ? data.candidates[0].content.parts[0].text
        : "";

    if (!raw) {
      return { statusCode: 500, body: JSON.stringify({ error: "Gemini returned an empty response." }) };
    }

    let clean = raw.trim();
    if (clean.startsWith("```")) {
      const firstNewline = clean.indexOf("\n");
      clean = firstNewline !== -1 ? clean.slice(firstNewline + 1) : clean.slice(3);
    }
    if (clean.endsWith("```")) {
      clean = clean.slice(0, -3);
    }
    clean = clean.trim();

    const parsed = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
