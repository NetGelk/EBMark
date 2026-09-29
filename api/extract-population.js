// Extracts the studied patient population from a paper as structured JSON,
// so /api/match-patient can compare a specific patient against it.

const SYSTEM_PROMPT = `You are an expert clinical methodologist. Read the paper details (title, journal, year, DOI, abstract) and extract the characteristics of the patient population that was actually studied.

Be precise and honest. Only report what the text supports. When a value cannot be determined, use null and add a short description of it to "cannot_determine". Every "confidence" field is "high", "medium" or "low".

Return ONLY valid JSON, with no prose and no code fences, in exactly this shape:
{
  "age": { "min": null, "max": null, "mean": null, "confidence": "low" },
  "sex": { "male_pct": null, "female_pct": null, "sex_restricted": null, "confidence": "low" },
  "sample_size": { "n_enrolled": null, "confidence": "low" },
  "inclusion_criteria": [],
  "exclusion_criteria": [],
  "renal_function": { "classification": "unknown", "specific_threshold": null, "confidence": "low" },
  "comorbidities": { "required": [], "excluded": [], "confidence": "low" },
  "lab_thresholds": {},
  "medications": { "required": [], "excluded": [], "confidence": "low" },
  "setting": { "clinical_context": null, "countries": [], "confidence": "low" },
  "representativeness_flags": [],
  "extraction_confidence_overall": "low",
  "extraction_notes": "",
  "cannot_determine": []
}

Field rules:
- age: numbers in years. mean may be a mean or median; say which in extraction_notes.
- sex.sex_restricted: "male", "female" or null when both sexes were eligible.
- renal_function.classification is one of: unrestricted | mild_ckd_allowed | moderate_ckd_allowed | no_dialysis | normal_only | dialysis_only | unknown. specific_threshold is the stated cut-off as text (e.g. "eGFR >= 30").
- lab_thresholds: key-value pairs of lab eligibility cut-offs, e.g. { "eGFR": ">= 30", "HbA1c": "7.0-10.5%" }.
- representativeness_flags: any of elderly_underrepresented, high_comorbidity_excluded, frail_excluded, real_world_gap, or another short snake_case flag when clearly warranted.
- extraction_confidence_overall: "high" | "medium" | "low", reflecting how much of the population the text actually describes.`;

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) return res.status(500).json({ error: 'API key not configured on server' });

const { title, abstract, doi, journal, year } = req.body || {};
if (!title && !abstract && !doi) return res.status(400).json({ error: 'Provide at least a title, abstract, or DOI' });

const userContent = `TITLE: ${title || 'Not provided'}
JOURNAL: ${journal || 'Not provided'}
YEAR: ${year || 'Not provided'}
DOI: ${doi || 'Not provided'}
ABSTRACT: ${abstract || 'Not provided'}`;

try {
const response = await fetch('https://api.anthropic.com/v1/messages', {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'x-api-key': apiKey,
'anthropic-version': '2023-06-01'
},
body: JSON.stringify({
model: 'claude-sonnet-5-5',
max_tokens: 2000,
temperature: 0,
system: SYSTEM_PROMPT,
messages: [{ role: 'user', content: userContent }]
})
});

const data = await response.json();
if (data.error) return res.status(500).json({ error: data.error.message });

const text = data.content?.[0]?.text || '';
const start = text.indexOf('{');
const end = text.lastIndexOf('}');
try {
  const population = JSON.parse(text.slice(start, end + 1));
  return res.status(200).json(population);
} catch {
  return res.status(502).json({ error: 'Could not parse the extracted population' });
}

} catch (err) {
return res.status(500).json({ error: err.message || 'Request failed' });
}
}
