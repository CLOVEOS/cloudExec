const express = require("express");
const { GoogleGenAI } = require('@google/genai');
const router = express.Router();

// Initialize the new client (convention is usually just 'ai')
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

router.post("/explain", async (req, res) => {
  const { code, error, language } = req.body;

  try {
    const prompt = `
      You are a compiler error expert. Analyze this ${language} error:
      Error: "${error}"
      Code: "${code}"

      Return a JSON object with exactly these keys:
      {
        "title": "Short name of error",
        "explanation": "Why it happened",
        "fix": "How to solve it",
        "fixed_code": "The full corrected code"
      }
    `;

    // The NEW syntax for calling the model and passing the JSON config
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json"
        }
    });

    // The NEW syntax for extracting the text payload (it is now a property, not a function)
    let text = response.text;

    // Parse and send
    const parsed = JSON.parse(text);
    res.json(parsed);

  } catch (err) {
    console.error("AI Error:", err);
    res.status(500).json({ 
      title: "Analysis Error", 
      explanation: "The AI sent a messy response. Try running it again.",
      fix: "Check your internet connection.",
      fixed_code: code 
    });
  }
});

module.exports = router;