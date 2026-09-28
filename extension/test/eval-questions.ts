/**
 * Twenty free-text questions for the draft eval, copied word for word from the corpus in `data/questions.json`.
 * Company questions sit with that company; general ones are spread across the rest. The posting summaries are
 * short ones written for the eval, not the real postings.
 */
export interface EvalQuestion {
  company: string;
  title: string;
  description: string;
  label: string;
  help: string;
}

const discord = {
  company: 'Discord',
  title: 'Senior Full-Stack Software Engineer, Developer Success',
  description:
    'The Developer Success team builds tools for game developers: APIs, the developer portal, realtime infrastructure and SDKs. The stack is mainly Python and TypeScript/React. Engineers lead projects end to end and work with partner game studios.',
};
const anthropic = {
  company: 'Anthropic',
  title: 'Software Engineer, Applied AI',
  description:
    'Build and ship features that help customers deploy Claude: evaluation tooling, agent workflows and integrations. Work closely with research and product teams; Python is used throughout.',
};
const figma = {
  company: 'Figma',
  title: 'Software Engineer, Data Platform',
  description:
    'Build the data platform behind Figma’s product analytics and internal tools: ingestion pipelines, storage and query services used by every team.',
};
const replit = {
  company: 'Replit',
  title: 'Software Engineer, Growth',
  description:
    'Run experiments across onboarding and activation for Replit’s cloud development environment and its AI agent, shipping full-stack features in TypeScript.',
};
const elevenlabs = {
  company: 'ElevenLabs',
  title: 'Software Engineer, Agents Platform',
  description:
    'Build the platform for voice agents: orchestration, tool calling, latency-sensitive streaming and developer APIs.',
};
const palantir = {
  company: 'Palantir',
  title: 'Backend Software Engineer',
  description:
    'Design and build backend services for data-integration products used by large institutions; own services from design through production.',
};
const perplexity = {
  company: 'Perplexity',
  title: 'Software Engineer, Backend',
  description:
    'Build the retrieval, ranking and serving systems behind Perplexity’s answer engine at high query volume.',
};
const wealthfront = {
  company: 'Wealthfront',
  title: 'Software Engineer, New Grad',
  description:
    'Build automated financial products; engineers own features across the backend and clients with a strong testing culture.',
};

export const questions: EvalQuestion[] = [
  { ...discord, label: 'Why do you want to work at Discord?', help: '' },
  {
    ...discord,
    label:
      'Tell us about a substantial project you’ve led from start to finish (either an end-to-end project or a significant workstream within a larger one). What did you own, and what was the outcome?',
    help: '',
  },
  { ...discord, label: 'What excites you most about this opportunity?', help: '' },
  {
    ...anthropic,
    label: 'Why Anthropic?',
    help: 'Why do you want to work at Anthropic? (We value this response highly - great answers are often 200-400 words.)',
  },
  { ...anthropic, label: 'How has AI changed the way you approach your work?', help: '' },
  {
    ...anthropic,
    label:
      'Tell us about a time you made a meaningful impact for a customer or client. What was the situation, and how did you approach it?',
    help: '',
  },
  {
    ...figma,
    label: 'Why do you want to join Figma?',
    help: 'Please share 3-4 sentences on why you want to join Figma',
  },
  { ...figma, label: "What's the hardest you've ever worked on something?", help: '' },
  { ...replit, label: 'What excites you about Replit?', help: '' },
  {
    ...replit,
    label: 'If you want to share something you built with Replit please share below.',
    help: 'You can try using Replit for free here',
  },
  { ...elevenlabs, label: 'Why ElevenLabs, and why now?', help: '' },
  {
    ...elevenlabs,
    label: "What's the most impactful thing you've built? What was your specific contribution?",
    help: '',
  },
  { ...elevenlabs, label: 'How did you know it worked? What did success actually look like?', help: '' },
  { ...palantir, label: 'Why do you want to work at Palantir?', help: '' },
  { ...palantir, label: 'What has been your favorite project or proudest accomplishment? Why?', help: '' },
  {
    ...palantir,
    label:
      'Describe your experience designing and implementing a backend service to support a complex/new user workflow requirement, and/or a way you improved user experience through backend optimizations.',
    help: '',
  },
  {
    ...perplexity,
    label: 'What are the most interesting aspects of Perplexity that you are excited to work on?',
    help: '',
  },
  {
    ...perplexity,
    label:
      'How do you use AI in your day-to-day work? What are some of the underappreciated benefits and/or pain points of your favorite AI tools?',
    help: '',
  },
  { ...wealthfront, label: 'Why are you interested in Wealthfront?', help: '' },
  { ...wealthfront, label: 'Please share any experience you have in building AI systems!', help: '' },
];
