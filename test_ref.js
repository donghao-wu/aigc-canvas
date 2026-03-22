const axios = require('./backend/node_modules/axios').default;

const API = 'http://localhost:3001';

async function test() {
  console.log('Step1: 生成苹果图...');
  const r1 = await axios.post(`${API}/api/generate-image`, {
    prompt: 'a red apple on white background',
    model: 'gemini-3-pro-image-preview',
    aspectRatio: '1:1',
    imageSize: '1K',
  }, { timeout: 120000 });

  const { base64, mimeType } = r1.data;
  console.log(`Step1 成功！base64长度=${base64.length} mime=${mimeType}`);

  console.log('Step2: 用参考图生图...');
  const r2 = await axios.post(`${API}/api/generate-image`, {
    prompt: 'turn this into Van Gogh painting style, swirling brushstrokes',
    model: 'gemini-3-pro-image-preview',
    aspectRatio: '1:1',
    imageSize: '1K',
    referenceImage: { base64, mimeType },
  }, { timeout: 180000 });

  if (r2.data.error) {
    console.error('Step2 失败:', r2.data.error);
  } else {
    console.log(`Step2 成功！base64长度=${r2.data.base64.length}`);
  }
}

test().catch(e => {
  const msg = e.response?.data?.error || e.message;
  console.error('失败:', msg);
});
