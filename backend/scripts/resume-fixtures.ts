import { mkdir, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { fileURLToPath } from 'node:url';
import { resumeSchema } from '../src/resume/schema.js';

// Fictional smoke fixtures; these are not real resumes or model-evaluation evidence.
const lines = [
  'Sample User',
  'Seattle, WA, United States',
  '+1 202 555 0100',
  'github.com/sample-user',
  'Experience',
  'Example Labs | Software Engineer Intern | Remote | Jun 2024 - Aug 2024',
  '- Built a TypeScript job tracker.',
  'Education',
  'Example University | B.S. | Computer Science | Sep 2020 - May 2024',
  'Skills: TypeScript, PostgreSQL',
  'Languages: English, Mandarin',
];
const directory = fileURLToPath(new URL('../../evals/synthetic/', import.meta.url));
await mkdir(directory, { recursive: true });
function pdf(lines: string[]) {
  const escape = (line: string) => line.replace(/[\\()]/g, '\\$&');
  const content = `BT /F1 11 Tf 45 745 Td 18 TL ${lines.map((line, i) => `${i ? 'T* ' : ''}(${escape(line)}) Tj`).join('\n')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(result);
}
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const docx = zipSync({
  '[Content_Types].xml': strToU8(
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  '_rels/.rels': strToU8(
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  'word/document.xml': strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`,
  ),
});
const gold = resumeSchema.parse({
  name: { first: 'Sample', last: 'User', preferred: '' },
  phone: '+1 202 555 0100',
  location: { city: 'Seattle', state: 'WA', country: 'United States' },
  links: { linkedin: '', github: 'https://github.com/sample-user', website: '' },
  education: [
    {
      school: 'Example University',
      degree: 'B.S.',
      level: 'bachelor',
      field: 'Computer Science',
      start: '2020-09',
      end: '2024-05',
      gpa: '',
      location: '',
    },
  ],
  experience: [
    {
      company: 'Example Labs',
      title: 'Software Engineer Intern',
      location: 'Remote',
      start: '2024-06',
      end: '2024-08',
      type: 'internship',
      description: '- Built a TypeScript job tracker.',
    },
  ],
  skills: ['TypeScript', 'PostgreSQL'],
  languages: ['English', 'Mandarin'],
  summary: '',
});
await writeFile(directory + 'sample.pdf', pdf(lines));
await writeFile(directory + 'sample.docx', docx);
await writeFile(directory + 'gold.json', JSON.stringify(gold, null, 2) + '\n');
await writeFile(
  directory + 'manifest.json',
  JSON.stringify(
    {
      description:
        'Two file formats of one fictional resume. Smoke checks only, not a representative accuracy dataset.',
      cases: ['pdf', 'docx'].map((format) => ({
        id: `synthetic-${format}`,
        subjectId: 'fictional-sample-v1',
        referenceReview: 'synthetic-fixture',
        file: `sample.${format}`,
        gold: 'gold.json',
        provenance: 'synthetic',
        source: 'Fictional fixture authored in scripts/resume-fixtures.ts',
        permission: 'Project-owned synthetic test data; no personal information.',
      })),
    },
    null,
    2,
  ) + '\n',
);
