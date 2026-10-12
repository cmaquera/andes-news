import { OllamaModel } from './model.mjs';
const start=performance.now();
const result=await new OllamaModel().summarize('ExampleJS introduces dependency checks','The open-source tool ExampleJS checks project dependencies for known vulnerabilities. Developers can run checks locally without uploading source code. It currently supports npm projects only and does not automatically fix issues.');
console.log(JSON.stringify({elapsedSeconds:Number(((performance.now()-start)/1000).toFixed(2)),...result},null,2));
