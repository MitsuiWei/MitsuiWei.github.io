const SCALE = 10000n;
function fixed(value, label, allowZero = false) {
  const s = String(value).trim();
  if (!/^\d+(\.\d{0,4})?$/.test(s)) throw new Error(`請輸入有效的${label}（最多 4 位小數）。`);
  const [whole, fraction = ''] = s.split('.');
  const n = BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
  if (n > 1000000000n * SCALE || (allowZero ? n < 0n : n <= 0n)) throw new Error(`${label}須${allowZero ? '大於或等於' : '大於'} 0，且不超過 10 億。`);
  return n;
}
export function calculate({capital, entry, stop, unit = '1', riskEnabled = false, riskType = 'money', risk = ''}) {
  const c=fixed(capital,'可用資金'),e=fixed(entry,'進場價格'),s=fixed(stop,'停損價格',true);
  if(s>=e) throw new Error('現股做多的停損價格，必須低於進場價格。');
  const lot=BigInt(unit);if(lot!==1n&&lot!==1000n)throw new Error('買入單位無效。');
  const gap=e-s,capitalShares=c/e/lot*lot;
  let budget=null,riskShares=null;
  if(riskEnabled){const r=fixed(risk,'風險額度',true);if(riskType==='percent'&&r>100n*SCALE)throw new Error('風險比例須介於 0% 與 100%。');budget=riskType==='percent'?c*r/(100n*SCALE):r;riskShares=budget/gap/lot*lot;}
  const q=riskShares!==null&&riskShares<capitalShares?riskShares:capitalShares;
  const toN=n=>Number(n)/Number(SCALE);
  return {shares:Number(q),capitalShares:Number(capitalShares),cost:toN(q*e),remaining:toN(c-q*e),loss:toN(q*gap),perShare:toN(gap),usage:Number(q*e)*100/Number(c),lossPercent:Number(q*gap)*100/Number(c),budget:budget===null?null:toN(budget),limitedBy:riskShares!==null&&riskShares<capitalShares?'risk':'capital'};
}
