// Netlify Function: Gemini API版 + フォールバック機構つき
// このファイルはサーバー側で実行されるため、APIキーがブラウザに見えることはありません。
// Netlifyの管理画面で環境変数 GEMINI_API_KEY を設定してください。
// （Google AI Studio: https://aistudio.google.com で無料枠のキーを発行できます）
//
// 仕組み: Gemini APIを呼び出し、失敗したら1回だけ自動リトライします。
// それでも失敗した場合は、JavaScriptだけで動く簡易ルール判定に切り替え、
// 常に何かしらの判定結果を返します（エラー画面を出さない）。

const SYSTEM_PROMPT = `あなたは日本のビジネスメールの丁寧さを判定する専門家です。与えられたメール本文を分析し、指定されたJSON形式で出力してください。

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

async function callGemini(text, apiKey, timeoutMs) {
  const model = "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: text }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error("Gemini API responded with status " + response.status);
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
      throw new Error("Gemini returned an empty response.");
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

    return JSON.parse(clean);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// AIが使えないときの簡易ルール判定（フォールバック）
function fallbackAnalyze(text) {
  const casualMarkers = ["だよ", "じゃん", "でしょ？", "かな？", "笑", "！！", "w ", "っす", "OK？", "だっけ"];
  const rudeMarkers = ["は？", "無理", "早くして", "急いで", "遅い", "ふざけ"];
  const politeMarkers = ["いただけますと", "何卒", "恐れ入ります", "お手数", "幸いです", "ございます", "いたします"];
  const stiffMarkers = ["謹啓", "拝啓", "貴社ますます", "衷心より"];

  let score = 65; // 基準スコア
  const flags = [];

  casualMarkers.forEach((m) => {
    if (text.includes(m)) {
      score -= 10;
      flags.push({
        phrase: m,
        type: "casual",
        note: "カジュアルすぎる表現です。ビジネスメールでは避けた方が無難です。",
        suggestion: "より丁寧な言い回しに変更する",
      });
    }
  });

  rudeMarkers.forEach((m) => {
    if (text.includes(m)) {
      score -= 20;
      flags.push({
        phrase: m,
        type: "rude",
        note: "きつい印象を与える可能性がある表現です。",
        suggestion: "柔らかい言い回しに変更する",
      });
    }
  });

  politeMarkers.forEach((m) => {
    if (text.includes(m)) {
      score += 8;
    }
  });

  stiffMarkers.forEach((m) => {
    if (text.includes(m)) {
      score -= 5;
      flags.push({
        phrase: m,
        type: "stiff",
        note: "やや硬すぎる、格式張った表現です。",
        suggestion: "一般的なビジネス敬語に変更する",
      });
    }
  });

  score = Math.max(0, Math.min(100, score));

  let verdict_short = "普通";
  let verdict_label = "標準的";
  if (score >= 80) {
    verdict_short = "丁寧";
    verdict_label = "丁寧な印象です";
  } else if (score >= 55) {
    verdict_short = "普通";
    verdict_label = "ちょうどよい印象です";
  } else if (score >= 35) {
    verdict_short = "注意";
    verdict_label = "やや配慮が必要です";
  } else {
    verdict_short = "失礼";
    verdict_label = "失礼な印象を与える可能性があります";
  }

  return {
    score,
    verdict_short,
    verdict_label,
    summary:
      "（簡易ルール判定）AIによる詳細判定が一時的に利用できなかったため、キーワードベースの簡易判定結果を表示しています。目安としてご利用ください。",
    flags: flags.slice(0, 4),
    improved_email:
      "（簡易ルール判定のため、全文の書き直し案は生成されていません。しばらくしてから再度お試しいただくと、AIによる詳細な言い換え案が表示されます。）",
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
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

  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    // 1回目の試行
    try {
      const result = await callGemini(text, apiKey, 18000);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
    } catch (err1) {
      // 2回目の試行（自動リトライ）
      try {
        const result = await callGemini(text, apiKey, 18000);
        return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
      } catch (err2) {
        // ここまで失敗したらフォールバックへ
      }
    }
  }

  // APIキー未設定、またはAI呼び出しが2回とも失敗した場合はフォールバック
  const fallback = fallbackAnalyze(text);
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(fallback) };
};
