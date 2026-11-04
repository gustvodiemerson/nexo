// Regenera server/schema.js a partir de db/schema.sql (o app embute o SQL para aplicar sozinho no primeiro acesso).
import fs from 'node:fs';
const sql = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').split('\n\n').slice(1).join('\n\n');
fs.writeFileSync(new URL('../server/schema.js', import.meta.url), '// Gerado a partir de db/schema.sql — mantenha os dois iguais (npm run schema).\nexport const SCHEMA = ' + JSON.stringify(sql) + ';\n');
