import { NextResponse } from 'next/server';
import fs from 'fs-extra';
import path from 'path';

const USER_TEMPLATES_DIR = path.join(process.cwd(), 'templates/user');
const DEFAULT_TEMPLATES_DIR = path.join(process.cwd(), 'templates/defaults');

// テンプレート一覧の取得
export async function GET() {
  try {
    if (!fs.existsSync(USER_TEMPLATES_DIR)) {
      fs.ensureDirSync(USER_TEMPLATES_DIR);
    }
    const templates = fs.readdirSync(USER_TEMPLATES_DIR);
    const results = templates.map(name => {
      const descPath = path.join(USER_TEMPLATES_DIR, name, 'description.md');
      const description = fs.existsSync(descPath) ? fs.readFileSync(descPath, 'utf-8') : '';
      return { name, description };
    });
    return NextResponse.json({ templates: results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// テンプレートの初期化・複製
export async function POST(request: Request) {
  try {
    const { action, name, sourceLang, sourceName } = await request.json();

    if (action === 'init') {
      // デフォルト(ja/en)の特定のサブディレクトリからコピー
      const { sourceSubDir } = await request.json().catch(() => ({})); // 既存呼び出しとの互換性
      const subDir = sourceSubDir || 'standard';
      
      const source = path.join(DEFAULT_TEMPLATES_DIR, sourceLang, subDir);
      const destName = sourceSubDir ? `${subDir}-${sourceLang}` : `default-${sourceLang}`;
      const dest = path.join(USER_TEMPLATES_DIR, destName);
      
      await fs.copy(source, dest);
      return NextResponse.json({ message: `Initialized ${subDir} (${sourceLang}) template` });
    }

    if (action === 'duplicate') {
      // 既存のユーザーテンプレートを複製
      const source = path.join(USER_TEMPLATES_DIR, sourceName);
      const dest = path.join(USER_TEMPLATES_DIR, name);
      if (fs.existsSync(dest)) {
        return NextResponse.json({ error: 'Template already exists' }, { status: 400 });
      }
      await fs.copy(source, dest);
      return NextResponse.json({ message: `Duplicated template to ${name}` });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
