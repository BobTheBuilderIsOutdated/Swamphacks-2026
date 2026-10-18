import { z } from 'zod';

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(100), objective: z.string().trim().min(5).max(2000),
  role: z.enum(['research', 'internship', 'job']), sectors: z.string().trim().min(2).max(1000),
  location: z.string().trim().min(2).max(200), radiusMiles: z.number().int().min(1).max(10000),
  remote: z.boolean(), mode: z.enum(['review', 'autonomous']).default('autonomous'),
  positiveMode: z.enum(['handoff', 'continue']).default('handoff'),
  dailyLimit: z.number().int().min(1).max(200).default(20),
  followupDays: z.number().int().min(2).max(30).default(5),
  maxFollowups: z.number().int().min(0).max(5).default(2),
  target: z.object({ name: z.string().trim().min(2).max(150), organization: z.string().trim().min(2).max(200), sourceUrl: z.string().url().refine(v => /^https?:\/\//.test(v), 'Use a public HTTP or HTTPS page.') }).optional(),
});
export function matchesTarget(candidate, target) {
  if (!target) return true;
  const normalize = value => value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ');
  return normalize(candidate.name) === normalize(target.name) && normalize(candidate.organization) === normalize(target.organization);
}
export const profileSchema = z.object({
  name: z.string().min(1), summary: z.string(), education: z.array(z.string()),
  skills: z.array(z.string()), experiences: z.array(z.string()), interests: z.array(z.string()),
  evidence: z.array(z.object({ fact: z.string(), document: z.string(), quote: z.string() })),
  writingStyle: z.object({ tone: z.string(), sentenceStyle: z.string(), greeting: z.string(), closing: z.string(), avoid: z.array(z.string()) }),
});
export const organizationSchema = z.object({ organizations: z.array(z.object({
  name: z.string().trim().min(2), website: z.string().url(), location: z.string(),
  distanceMiles: z.number().nonnegative().nullable(), remote: z.boolean(),
  sectorFit: z.string().min(1), sources: z.array(z.object({ url: z.string().url(), title: z.string(), excerpt: z.string().min(1) })).min(1),
})), searchSummary: z.string() });
export const organizationKey = value => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
export const researchSchema = z.object({ leads: z.array(z.object({
  name: z.string().min(1), email: z.string().email(), organization: z.string().min(1), title: z.string(),
  location: z.string(), distanceMiles: z.number().nonnegative().nullable(), remote: z.boolean(),
  fit: z.string(), matchedSkills: z.array(z.string()), angle: z.string(),
  contactSource: z.string().url(), sources: z.array(z.object({ url: z.string().url(), title: z.string(), excerpt: z.string() })).min(1),
})), searchSummary: z.string() });
export const draftSchema = z.object({
  subject: z.string().min(1).max(180), body: z.string().min(1).max(10000),
  missingFacts: z.array(z.string()), needsHuman: z.boolean(), reason: z.string(),
  usedProfileFacts: z.array(z.string()), usedSourceUrls: z.array(z.string().url()),
});
export const classificationSchema = z.object({
  intent: z.enum(['positive', 'question', 'neutral', 'rejected', 'unsubscribe', 'bounce', 'out_of_office', 'sensitive']),
  confidence: z.number().min(0).max(1), summary: z.string(), nextStep: z.string(),
});

export function draftProblems(draft, profile, research) {
  const errors = [];
  if (draft.missingFacts.length || draft.needsHuman) errors.push('The draft needs your input.');
  if (/\[[^\]]+\]|\{\{[^}]+\}\}/.test(draft.body)) errors.push('The draft contains unresolved placeholders.');
  if (/[\r\n]/.test(draft.subject)) errors.push('Invalid subject header.');
  const facts = new Set(profile.evidence.map(e => e.fact));
  if (!draft.usedProfileFacts.length || draft.usedProfileFacts.some(f => !facts.has(f))) errors.push('Profile claims are not supported by uploaded documents.');
  const urls = new Set(research.sources.map(s => s.url));
  if (!draft.usedSourceUrls.length || draft.usedSourceUrls.some(u => !urls.has(u))) errors.push('Personalization lacks a verified source.');
  return errors;
}
