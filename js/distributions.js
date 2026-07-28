(function(root,factory){const api=factory(typeof require==='function'?require('./math.js'):root.NICUMath);if(typeof module==='object'&&module.exports)module.exports=api;root.NICUDistributions=api;})(typeof self!=='undefined'?self:this,function(M){
'use strict';

function survival(u,fitOrName,mu,sigma2,kappa){
  const fit=typeof fitOrName==='string'?{name:fitOrName,kappa}:fitOrName;
  const name=String(fit.name||'Lognormal').toLowerCase();
  const x=Number(u);
  if(x<=0)return 1;
  const mean=M.clampPositive(mu??fit.mean);
  const variance=Math.max(0,Number(sigma2??fit.variance??mean));
  const shape=M.clampPositive(kappa??fit.kappa??1.5);

  if(name==='exponential')return Math.exp(-x/mean);
  if(name==='weibull'){
    const scale=mean/M.gamma(1+1/shape);
    return Math.exp(-Math.pow(x/M.clampPositive(scale),shape));
  }
  if(name==='lognormal'){
    const tau=Math.sqrt(Math.log(1+variance/(mean*mean)));
    const muLog=Math.log(mean)-0.5*tau*tau;
    return 1-M.normalCdf((Math.log(x)-muLog)/M.clampPositive(tau));
  }
  if(name==='gamma'){
    const scale=mean/shape;
    return M.regularizedGammaQ(shape,x/M.clampPositive(scale));
  }
  if(name==='fisk'){
    // Manuscript conditional-survival specification (Burr Type XII).
    const scale=mean/(Math.PI/shape);
    return Math.pow(scale/(x+scale),shape);
  }
  throw new Error('Unknown LOS distribution: '+fit.name);
}

function marginalSurvival(x,fit){
  const name=fit.name.toLowerCase();
  if(x<=0)return 1;
  if(name==='exponential')return Math.exp(-x/fit.scale);
  if(name==='weibull')return Math.exp(-Math.pow(x/fit.scale,fit.kappa));
  if(name==='lognormal')return 1-M.normalCdf((Math.log(x)-fit.muLog)/fit.tau);
  if(name==='gamma')return M.regularizedGammaQ(fit.kappa,x/fit.scale);
  if(name==='fisk')return Math.pow(fit.scale/(x+fit.scale),fit.kappa);
  return NaN;
}

function q99(fit){
  const name=fit.name.toLowerCase();
  if(name==='exponential')return-fit.scale*Math.log(0.01);
  if(name==='weibull')return fit.scale*Math.pow(-Math.log(0.01),1/fit.kappa);
  if(name==='lognormal')return Math.exp(fit.muLog+fit.tau*M.inverseNormalCdf(0.99));
  if(name==='gamma')return M.gammaQuantile(0.99,fit.kappa,fit.scale);
  if(name==='fisk')return fit.scale*(Math.pow(100,1/fit.kappa)-1);
  return fit.max;
}

function kmCurve(records){
  const clean=records.map(record=>({
    t:Number(record.los_days??record.los??record.time),
    event:record.event==null?1:Number(record.event)
  })).filter(record=>record.t>0&&Number.isFinite(record.t)).sort((a,b)=>a.t-b.t);
  let atRisk=clean.length,survivalProbability=1;
  const out=[{time:0,survival:1}];
  let i=0;
  while(i<clean.length){
    const time=clean[i].t;
    let events=0,censored=0;
    while(i<clean.length&&clean[i].t===time){
      if(clean[i].event===0)censored++;else events++;
      i++;
    }
    if(atRisk>0&&events>0)survivalProbability*=1-events/atRisk;
    out.push({time,survival:survivalProbability});
    atRisk-=events+censored;
  }
  return out;
}

function empiricalAt(curve,x){
  let value=1;
  for(const point of curve){if(point.time>x)break;value=point.survival;}
  return value;
}

function finalize(fit,records){
  const values=records.map(record=>Number(record.los_days??record.los??record.time)).filter(value=>value>0);
  const curve=kmCurve(records);
  const max=Math.max(...values);
  const smax=Math.max(1,Math.floor(Math.min(max,q99(fit))));
  let squaredError=0,count=0;
  for(let u=0;u<=smax;u++){
    const empirical=empiricalAt(curve,u);
    const parametric=marginalSurvival(u,fit);
    if(Number.isFinite(parametric)){
      squaredError+=(empirical-parametric)**2;
      count++;
    }
  }
  fit.rmse=Math.sqrt(squaredError/Math.max(1,count));
  fit.smax=smax;
  fit.max=max;
  fit.curve=curve;
  return fit;
}

function valuesFrom(records){return records.map(record=>Number(record.los_days??record.los??record.time)).filter(value=>value>0);}

function fitExponential(records){
  const x=valuesFrom(records),scale=M.mean(x);
  return finalize({name:'Exponential',scale,mean:scale,variance:scale*scale,kappa:null,logLik:-x.length*Math.log(scale)-M.sum(x)/scale},records);
}

function fitLognormal(records){
  const x=valuesFrom(records),logs=x.map(Math.log),muLog=M.mean(logs);
  const tau=Math.sqrt(M.mean(logs.map(value=>(value-muLog)**2)))||1e-6;
  const mean=Math.exp(muLog+0.5*tau*tau);
  const variance=(Math.exp(tau*tau)-1)*Math.exp(2*muLog+tau*tau);
  const logLik=-M.sum(x.map((value,i)=>Math.log(value*tau*Math.sqrt(2*Math.PI))+0.5*((logs[i]-muLog)/tau)**2));
  return finalize({name:'Lognormal',muLog,tau,mean,variance,kappa:null,logLik},records);
}

function fitWeibull(records){
  const x=valuesFrom(records),logs=x.map(Math.log),meanLog=M.mean(logs);
  let shape=1.2/(Math.sqrt(M.variance(x))/M.mean(x)||1);
  shape=Math.min(10,Math.max(0.1,shape));
  for(let iteration=0;iteration<80;iteration++){
    const weighted=x.map(value=>Math.exp(shape*Math.log(value)));
    const sumWeighted=M.sum(weighted);
    const sumWeightedLog=M.sum(weighted.map((value,i)=>value*logs[i]));
    const sumWeightedLog2=M.sum(weighted.map((value,i)=>value*logs[i]*logs[i]));
    const gradient=1/shape+meanLog-sumWeightedLog/sumWeighted;
    const derivative=-1/(shape*shape)-(sumWeightedLog2*sumWeighted-sumWeightedLog*sumWeightedLog)/(sumWeighted*sumWeighted);
    let next=shape-gradient/derivative;
    if(!Number.isFinite(next)||next<=0.05)next=(shape+0.05)/2;
    if(Math.abs(next-shape)<1e-8){shape=next;break;}
    shape=Math.min(20,next);
  }
  const scale=Math.pow(M.mean(x.map(value=>Math.pow(value,shape))),1/shape);
  const mean=scale*M.gamma(1+1/shape);
  const variance=scale*scale*(M.gamma(1+2/shape)-M.gamma(1+1/shape)**2);
  const logLik=x.length*Math.log(shape)-x.length*shape*Math.log(scale)+(shape-1)*M.sum(logs)-M.sum(x.map(value=>Math.pow(value/scale,shape)));
  return finalize({name:'Weibull',kappa:shape,scale,mean,variance,logLik},records);
}

function fitGamma(records){
  const x=valuesFrom(records),mean=M.mean(x);
  const s=Math.log(mean)-M.mean(x.map(Math.log));
  let shape=(3-s+Math.sqrt((s-3)**2+24*s))/(12*s||1);
  shape=Math.max(0.05,shape);
  for(let iteration=0;iteration<80;iteration++){
    const gradient=Math.log(shape)-M.digamma(shape)-s;
    const derivative=1/shape-M.trigamma(shape);
    const next=shape-gradient/derivative;
    if(!Number.isFinite(next)||next<=0.02)break;
    if(Math.abs(next-shape)<1e-9){shape=next;break;}
    shape=next;
  }
  const scale=mean/shape;
  const variance=shape*scale*scale;
  const logLik=(shape-1)*M.sum(x.map(Math.log))-M.sum(x)/scale-x.length*(M.logGamma(shape)+shape*Math.log(scale));
  return finalize({name:'Gamma',kappa:shape,scale,mean,variance,logLik},records);
}

function fitFisk(records){
  const x=valuesFrom(records);
  const minimum=Math.max(Math.min(...x),1e-6);
  const upper=Math.max(M.quantile(x,0.95)*100,M.mean(x)*100,minimum*1000);
  function fitAt(logScale){
    const scale=Math.exp(logScale);
    const logTerms=x.map(value=>Math.log1p(value/scale));
    const denominator=M.sum(logTerms);
    const shape=denominator>0?x.length/denominator:1e6;
    if(!Number.isFinite(shape)||shape<=0)return{value:Infinity,shape,scale};
    const logLik=x.length*Math.log(shape)-x.length*Math.log(scale)-(shape+1)*denominator;
    return{value:-logLik,shape,scale,logLik};
  }
  const optimum=M.goldenSectionMin(logScale=>fitAt(logScale).value,Math.log(minimum/100),Math.log(upper),1e-6,140);
  const fitted=fitAt(optimum.x);
  const mean=fitted.shape>1?fitted.scale/(fitted.shape-1):M.mean(x);
  const variance=fitted.shape>2?fitted.scale*fitted.scale*fitted.shape/((fitted.shape-1)**2*(fitted.shape-2)):M.variance(x);
  return finalize({name:'Fisk',kappa:fitted.shape,scale:fitted.scale,mean,variance,logLik:fitted.logLik},records);
}

function fitAll(records){
  if(!records||records.length<3)throw new Error('At least 3 LOS observations are required for automatic fitting.');
  const empiricalMean=M.mean(valuesFrom(records));
  const fits=[fitExponential(records),fitWeibull(records),fitLognormal(records),fitGamma(records),fitFisk(records)];
  fits.sort((a,b)=>a.rmse-b.rmse);
  return{best:fits[0],fits,km:fits[0].curve,empiricalMean};
}

return{survival,marginalSurvival,kmCurve,empiricalAt,fitAll,q99};
});
