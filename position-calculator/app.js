import {calculate} from './calc.mjs';
const $=id=>document.getElementById(id);
const num=n=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:4}).format(n);
const money=n=>'NT$ '+num(n);
const output=['shares','lots','usage','cost','remaining','per-share','loss','loss-percent'];
function clearResults(){
  output.forEach(id=>$(id).textContent='—');
  $('bar').style.width='0%';$('constraint').textContent='等待輸入';
  $('zero-note').hidden=true;$('risk-help').textContent='';$('error').hidden=true;
}
function update(){
  const enabled=$('risk-enabled').checked;
  $('risk-settings').hidden=!enabled;
  $('risk-unit').textContent=$('risk-type').value==='percent'?'%':'元';
  $('formula').textContent=enabled?'可買股數 =「資金 ÷ 進場價」與「風險額度 ÷ 每股停損價差」取較小值，再無條件捨去至買入單位。':'可買股數 = 可用資金 ÷ 進場價，無條件捨去至買入單位。';
  if(['capital','entry','stop',...(enabled?['risk']:[])].some(id=>$(id).value.trim()==='')){clearResults();return;}
  try{
    const r=calculate({capital:$('capital').value,entry:$('entry').value,stop:$('stop').value,unit:$('unit').value,riskEnabled:enabled,riskType:$('risk-type').value,risk:$('risk').value});
    $('error').hidden=true;
    $('shares').textContent=num(r.shares);$('lots').textContent=`${num(Math.floor(r.shares/1000))} 張 + ${num(r.shares%1000)} 股`;
    $('usage').textContent=r.usage.toFixed(2)+'%';$('bar').style.width=Math.min(100,r.usage)+'%';
    $('cost').textContent=money(r.cost);$('remaining').textContent=money(r.remaining);$('per-share').textContent=money(r.perShare);$('loss').textContent=money(r.loss);$('loss-percent').textContent=`資金的 ${r.lossPercent.toFixed(2)}%`;
    $('constraint').textContent=r.limitedBy==='risk'?'受虧損額度限制':'依可用資金';
    $('risk-help').textContent=enabled?`本筆虧損額度 ${money(r.budget)}（未含交易成本）`:'';
    $('zero-note').hidden=r.shares!==0;$('zero-note').textContent='目前的資金或虧損額度，不足以買入一個所選單位。';
  }catch(e){$('error').hidden=false;$('error').textContent=e.message;output.forEach(id=>$(id).textContent='—');$('bar').style.width='0%';$('constraint').textContent='等待有效輸入';$('zero-note').hidden=true;$('risk-help').textContent='';}
}
$('form').addEventListener('submit',e=>e.preventDefault());
$('form').addEventListener('input',update);
$('risk-type').addEventListener('change',()=>{$('risk').value='';update();});
$('reset').addEventListener('click',()=>{$('form').reset();update();});
update();
