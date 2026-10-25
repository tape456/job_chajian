// 生成最小可用 ASCII PDF，用于验证 pdf.js worker 在扩展页可加载并抽取文本
const fs = require('fs');
const path = require('path');

const lines = [
  'Resume Sample',
  'Name: Test User',
  'Phone: 13900139000',
  'Email: tester@example.com'
];
let stream = 'BT /F1 12 Tf 72 720 Td 18 TL\n';
stream += `(${lines[0].replace(/[()\\]/g, '')}) Tj T*\n`;
for (const l of lines.slice(1)) stream += `(${l.replace(/[()\\]/g, '')}) Tj T*\n`;
stream += 'ET';

const objs = [];
objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
objs[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
objs[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

let pdf = '%PDF-1.4\n';
const offsets = [];
for (let i = 1; i <= 5; i++) {
  offsets[i] = pdf.length;
  pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
}
const xrefPos = pdf.length;
pdf += 'xref\n0 6\n0000000000 65535 f \n';
for (let i = 1; i <= 5; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

fs.writeFileSync(path.join(__dirname, '..', 'test', 'sample-resume.pdf'), pdf, 'binary');
console.log('sample-resume.pdf written', pdf.length, 'bytes');
