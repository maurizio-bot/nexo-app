import sharp from 'sharp';
import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SIZES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192
};

const SPLASH_SIZES = {
  'drawable-land-mdpi': { w: 480, h: 320 },
  'drawable-land-hdpi': { w: 800, h: 480 },
  'drawable-land-xhdpi': { w: 1280, h: 720 },
  'drawable-land-xxhdpi': { w: 1600, h: 960 },
  'drawable-land-xxxhdpi': { w: 1920, h: 1280 },
  'drawable-mdpi': { w: 320, h: 480 },
  'drawable-hdpi': { w: 480, h: 800 },
  'drawable-xhdpi': { w: 720, h: 1280 },
  'drawable-xxhdpi': { w: 960, h: 1600 },
  'drawable-xxxhdpi': { w: 1280, h: 1920 }
};

async function generate() {
  const logoPath = join(__dirname, '..', 'assets', 'logo.png');
  const androidRes = join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'res');
  
  console.log('🎨 Leyendo logo fuente...');
  const logoBuffer = await sharp(logoPath).toBuffer();
  
  // 1. Generar IC_LAUNCHER (elimina la H azul del menú de apps)
  console.log('📱 Generando íconos del launcher...');
  for (const [folder, size] of Object.entries(SIZES)) {
    const outputDir = join(androidRes, folder);
    await fs.mkdir(outputDir, { recursive: true });
    
    // ic_launcher.png (ícono cuadrado para API < 25)
    await sharp(logoBuffer)
      .resize(size, size, { 
        fit: 'contain', 
        background: { r: 10, g: 10, b: 10, alpha: 1 } 
      })
      .png()
      .toFile(join(outputDir, 'ic_launcher.png'));
    
    // ic_launcher_foreground.png (para adaptive icons API 26+)
    await sharp(logoBuffer)
      .resize(size, size, { 
        fit: 'contain', 
        background: { r: 0, g: 0, b: 0, alpha: 0 } 
      })
      .png()
      .toFile(join(outputDir, 'ic_launcher_foreground.png'));
      
    // ic_launcher_round.png (versión redonda para algunos launchers)
    const roundSize = size;
    const roundCanvas = sharp({
      create: {
        width: roundSize,
        height: roundSize,
        channels: 4,
        background: { r: 10, g: 10, b: 10, alpha: 1 }
      }
    });
    
    const logoRounded = await sharp(logoBuffer)
      .resize(Math.floor(size * 0.7), Math.floor(size * 0.7), { fit: 'contain' })
      .toBuffer();
      
    await roundCanvas
      .composite([{ input: logoRounded, gravity: 'center' }])
      .png()
      .toFile(join(outputDir, 'ic_launcher_round.png'));
    
    console.log(`  ✅ ${folder}: ${size}px`);
  }
  
  // 2. Generar SPLASH SCREENS (cubre la pantalla mientras carga WebView)
  console.log('🖼️ Generando splash screens...');
  for (const [folder, { w, h }] of Object.entries(SPLASH_SIZES)) {
    const outputDir = join(androidRes, folder);
    await fs.mkdir(outputDir, { recursive: true });
    
    const isLandscape = folder.includes('land');
    const logoSize = Math.min(w, h) * 0.25; // Logo al 25% del ancho/alto menor
    
    const canvas = sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { r: 10, g: 10, b: 10, alpha: 1 } // #0a0a0a de NEXO
      }
    });
    
    const logoResized = await sharp(logoBuffer)
      .resize(Math.floor(logoSize), Math.floor(logoSize), { fit: 'contain' })
      .toBuffer();
    
    await canvas
      .composite([{ input: logoResized, gravity: 'center' }])
      .png()
      .toFile(join(outputDir, 'splash.png'));
      
    console.log(`  ✅ ${folder}: ${w}x${h}`);
  }
  
  console.log('✨ Assets Android generados');
  console.log('🚀 El "H azul" será reemplazado por tu logo NEXO');
}

generate().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});

