// Compares one patient against a study population from /api/extract-population
// and judges whether the study's evidence applies to that patient.

const SYSTEM_PROMPT = `You are an expert clinical methodologist doing patient-evidence matching. You receive a patient profile, the extracted population of a study, and the paper's details. Decide whether the study's evidence applies to this patient.

Method:
1. Check the patient against EVERY exclusion criterion, one by one. For each, decide patient_status: "excluded" (the patient would have been excluded), "not_excluded", or "uncertain" (patient data is missing or ambiguous).
2. Then compare age, sex, renal function, comorbidities, medications, lab thresholds and setting against the population.
3. Grade each mismatch's significance as "critical" (the patient would have been excluded, or the difference plausibly reverses benefit or harm), "significant" (a meaningful gap that weakens applicability), "minor" (unlikely to change the conclusion), or "unknown" (cannot be judged from the data).
4. Choose the verdict:
   - DIRECTLY_APPLICABLE: no critical or significant mismatches.
   - APPLICABLE_WITH_CAVEATS: no critical mismatches, some significant ones.
   - LIMITED_APPLICABILITY: one critical or several significant mismatches, but some evidence still transfers.
   - NOT_APPLICABLE: the patient meets an exclusion criterion that matters for the outcome, or is fundamentally outside the studied population.
Never invent patient data. If something needed is missing, list it in missing_patient_data and treat the related criteria as "uncertain".

Return ONLY valid JSON, with no prose and no code fences, in exactly this shape:
{
  "verdict": "DIRECTLY_APPLICABLE | APPLICABLE_WITH_CAVEATS | LIMITED_APPLICABILITY | NOT_APPLICABLE",
  "verdict_summary": "one sentence",
  "exclusion_matches": [ { "criterion": "", "patient_status": "excluded | not_excluded | uncertain", "significance": "critical | significant | minor | unknown", "explanation": "" } ],
  "critical_mismatches": [],
  "significant_mismatches": [],
  "minor_mismatches": [],
  "unknown_mismatches": [],
  "representativeness_assessment": { "age_fit": "", "comorbidity_fit": "", "overall_fit": "", "notes": "" },
  "patient_specific_recommendation": { "what_evidence_supports": "", "caveats": [], "evidence_gaps_for_this_patient": "", "seek_additional_evidence": false },
  "missing_patient_data": [],
  "confidence": "high | medium | low",
  "matching_notes": ""
}
Each *_mismatches array holds short plain-English strings, one per mismatch.`;

export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) return res.status(500).json({ error: 'API key not configured on server' });

const { patient, population, paper } = req.body || {};
if (!patient || !population) return res.status(400).json({ error: 'Missing patient or population' });

const userContent = `PATIENT PROFILE:
${JSON.stringify(patient, null, 2)}

STUDY POPULATION:
${JSON.stringify(population, null, 2)}

PAPER:
${JSON.stringify(paper || {}, null, 2)}`;

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
  return res.status(200).json(JSON.parse(text.slice(start, end + 1)));
} catch {
  return res.status(502).json({ error: 'Could not parse the patient match' });
}

} catch (err) {
return res.status(500).json({ error: err.message || 'Request failed' });
}
}
