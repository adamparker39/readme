import express from "express";
import helmet from "helmet";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "32kb" }));

const port = process.env.PORT || 3000;
const apiKey = process.env.OPENAI_API_KEY;
const appToken = process.env.APP_SHARED_SECRET;
const model = process.env.OPENAI_MODEL || "gpt-5.5";

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/soap", rateLimit({ windowMs: 60_000, limit: 8 }), async (req, res) => {
  if (!apiKey || !appToken) return res.status(503).json({ error: "Backend is not configured." });
  if (req.get("authorization") !== `Bearer ${appToken}`) return res.status(401).json({ error: "Unauthorised." });
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "A JSON clinical-data object is required." });
  }

  // The app sends a strict allowlist. Reject obvious direct identifiers if a client is altered.
  const forbidden = /(first name|last name|middle initial|date of birth|phone number|social security|patient address|guardian name)/i;
  if (Object.keys(req.body).some(k => forbidden.test(k))) {
    return res.status(400).json({ error: "Direct identifiers must not be submitted." });
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.responses.create({
      model,
      instructions: `You draft clinical SOAP documentation for a trained emergency medical technician.
Use ONLY facts explicitly present in the supplied clinical data. Never invent, infer, diagnose, embellish, or add normal findings, symptoms, examination findings, treatments, advice, referrals, transport decisions, or times.
Keep the language clear, concise, objective and clinically appropriate. Preserve supplied values and units exactly.
Put patient-reported information in subjective; documented observations, examination findings and interventions in objective; only explicitly documented clinical impression in assessment; and only explicitly documented actions/disposition in plan.
If a section has no supporting information, return an empty string for it. Do not write "not assessed" unless the source explicitly says that.
Additional remarks should contain only relevant documented details not already placed elsewhere.
Do not include patient names or other direct identifiers. Return JSON only with keys: subjective, objective, assessment, plan, additional_remarks.`,
      input: JSON.stringify(req.body),
      text: { format: { type: "json_object" } }
    });
    const parsed = JSON.parse(response.output_text || "{}");
    const result = {
      subjective: String(parsed.subjective || ""),
      objective: String(parsed.objective || ""),
      assessment: String(parsed.assessment || ""),
      plan: String(parsed.plan || ""),
      additional_remarks: String(parsed.additional_remarks || "")
    };
    res.json(result);
  } catch (_error) {
    // Do not log request bodies or patient clinical data.
    res.status(502).json({ error: "SOAP generation failed. Please try again." });
  }
});

app.listen(port, () => console.log(`SOAP backend listening on ${port}`));
