(function(root,factory){const api=factory(typeof require==='function'?require('./math.js'):root.NICUMath);if(typeof module==='object'&&module.exports)module.exports=api;root.NICUPreprocessing=api;})(typeof self!=='undefined'?self:this,function(M){
'use strict';

const STL_PERIOD=7;
const STL_GRID={
  seasonalWindows:[7,15,31],
  trendWindows:[15,31,61],
  seasonalDegrees:[1,2],
  trendDegrees:[1,2],
  robustFlags:[false,true]
};
const VARIANCE_WINDOWS=[7,15,31];

function oddSpan(value,min=3){let n=Math.max(min,Math.round(Number(value)||min));if(n%2===0)n+=1;return n;}

function spanBounds(n,index,span){
  const width=Math.min(n,oddSpan(span));
  let lo=index-Math.floor(width/2);
  let hi=lo+width-1;
  if(lo<0){hi-=lo;lo=0;}
  if(hi>=n){lo-=hi-(n-1);hi=n-1;}
  return{lo:Math.max(0,lo),hi};
}

function localPoly(series,window,degree=1,externalWeights=null){
  const n=series.length;
  if(!n)return[];
  const out=new Array(n);
  const deg=Math.max(0,Math.min(2,Math.floor(degree)));
  for(let i=0;i<n;i++){
    const{lo,hi}=spanBounds(n,i,window);
    const maxD=Math.max(1,Math.max(i-lo,hi-i));
    const A=Array.from({length:deg+1},()=>new Array(deg+1).fill(0));
    const b=new Array(deg+1).fill(0);
    let weightSum=0,weightedValue=0;
    for(let j=lo;j<=hi;j++){
      const y=Number(series[j]);
      if(!Number.isFinite(y))continue;
      const x=j-i;
      const u=Math.abs(x)/maxD;
      const tricube=u<1?Math.pow(1-u*u*u,3):(j===i?1:0);
      const robust=externalWeights?Math.max(0,Number(externalWeights[j])||0):1;
      const wt=tricube*robust;
      if(!(wt>0))continue;
      weightSum+=wt;
      weightedValue+=wt*y;
      const powers=[1];
      for(let p=1;p<=2*deg;p++)powers[p]=powers[p-1]*x;
      for(let r=0;r<=deg;r++){
        b[r]+=wt*y*powers[r];
        for(let c=0;c<=deg;c++)A[r][c]+=wt*powers[r+c];
      }
    }
    if(!(weightSum>0)){out[i]=Number(series[i])||0;continue;}
    const beta=M.solveLinear(A,b);
    const estimate=beta[0];
    out[i]=Number.isFinite(estimate)?estimate:weightedValue/weightSum;
  }
  return out;
}

function movingAverage(series,window){
  const n=series.length;
  if(!n)return[];
  const width=Math.max(1,Math.floor(window));
  const half=Math.floor(width/2);
  const out=new Array(n);
  for(let i=0;i<n;i++){
    let sum=0,count=0;
    for(let j=i-half;j<=i+half;j++){
      const idx=Math.min(n-1,Math.max(0,j));
      const value=Number(series[idx]);
      if(Number.isFinite(value)){sum+=value;count++;}
    }
    out[i]=count?sum/count:0;
  }
  return out;
}

function cycleSubseriesSmooth(detrended,period,window,degree,weights){
  const seasonal=new Array(detrended.length).fill(0);
  for(let phase=0;phase<period;phase++){
    const indices=[],sub=[],subWeights=[];
    for(let i=phase;i<detrended.length;i+=period){
      indices.push(i);
      sub.push(detrended[i]);
      subWeights.push(weights?weights[i]:1);
    }
    const smoothed=localPoly(sub,window,degree,subWeights);
    indices.forEach((index,j)=>{seasonal[index]=smoothed[j];});
  }
  return seasonal;
}

function lowPassFilter(seasonal,period){
  const pass1=movingAverage(seasonal,period);
  const pass2=movingAverage(pass1,period);
  const pass3=movingAverage(pass2,3);
  return localPoly(pass3,oddSpan(period),1);
}

function robustnessWeights(residual){
  const absolute=residual.map(value=>Math.abs(Number(value))).filter(Number.isFinite);
  const median=M.median(absolute);
  if(!(median>1e-12))return new Array(residual.length).fill(1);
  const scale=6*median;
  return residual.map(value=>{
    const u=Math.abs(Number(value))/scale;
    return u>=1?0:Math.pow(1-u*u,2);
  });
}

// Browser implementation of the STL workflow described in the manuscript:
// weekly seasonal period, LOESS seasonal/trend smoothers, and optional robust
// outer iterations. The grid-search settings are evaluated independently per site.
function stlApprox(series,cfg){
  const y=series.map(value=>Number.isFinite(Number(value))?Number(value):0);
  const n=y.length;
  let trend=localPoly(y,cfg.trendWindow,cfg.trendDegree);
  let seasonal=new Array(n).fill(0);
  let weights=new Array(n).fill(1);
  const outerIterations=cfg.robust?3:1;
  const innerIterations=2;

  for(let outer=0;outer<outerIterations;outer++){
    for(let inner=0;inner<innerIterations;inner++){
      const detrended=y.map((value,i)=>value-trend[i]);
      const rawSeasonal=cycleSubseriesSmooth(
        detrended,
        STL_PERIOD,
        cfg.seasonalWindow,
        cfg.seasonalDegree,
        weights
      );
      const lowPass=lowPassFilter(rawSeasonal,STL_PERIOD);
      seasonal=rawSeasonal.map((value,i)=>value-lowPass[i]);
      const deseasonalized=y.map((value,i)=>value-seasonal[i]);
      trend=localPoly(deseasonalized,cfg.trendWindow,cfg.trendDegree,weights);
    }
    const residual=y.map((value,i)=>value-trend[i]-seasonal[i]);
    if(cfg.robust&&outer<outerIterations-1)weights=robustnessWeights(residual);
  }

  const residual=y.map((value,i)=>value-trend[i]-seasonal[i]);
  return{trend,seasonal,residual,score:M.std(residual,true)};
}

function chooseStl(series){
  let best=null,candidatesTested=0;
  for(const seasonalWindow of STL_GRID.seasonalWindows){
    for(const trendWindow of STL_GRID.trendWindows){
      for(const seasonalDegree of STL_GRID.seasonalDegrees){
        for(const trendDegree of STL_GRID.trendDegrees){
          for(const robust of STL_GRID.robustFlags){
            const config={seasonalWindow,trendWindow,seasonalDegree,trendDegree,robust};
            const result=stlApprox(series,config);
            candidatesTested++;
            if(!best||result.score<best.score-1e-12)best={config,...result};
          }
        }
      }
    }
  }
  return{...best,candidatesTested};
}

function rollingStandardDeviation(residual,window){
  const n=residual.length,half=Math.floor(window/2),out=new Array(n);
  for(let i=0;i<n;i++){
    const values=[];
    for(let j=Math.max(0,i-half);j<=Math.min(n-1,i+half);j++){
      const value=Number(residual[j]);
      if(Number.isFinite(value))values.push(value);
    }
    out[i]=Math.sqrt(Math.max(0,M.variance(values,true)));
  }
  return out;
}

function volatilityStability(sdSeries){
  const values=sdSeries.filter(Number.isFinite);
  if(!values.length)return Infinity;
  const mean=M.mean(values);
  const spread=M.std(values,true);
  return mean>1e-12?spread/mean:spread;
}

function chooseRollingVariance(residual){
  let best=null;
  const candidates=[];
  for(const window of VARIANCE_WINDOWS){
    const standardDeviation=rollingStandardDeviation(residual,window);
    const score=volatilityStability(standardDeviation);
    const candidate={window,standardDeviation,score};
    candidates.push({window,score});
    if(
      !best||
      score<best.score-1e-12||
      (Math.abs(score-best.score)<=1e-12&&window>best.window)
    )best=candidate;
  }
  return{
    window:best.window,
    score:best.score,
    variance:best.standardDeviation.map(value=>Math.max(1e-6,value*value)),
    candidates
  };
}

function fillMissing(series){
  const out=series.slice();
  const known=[];
  out.forEach((value,index)=>{if(Number.isFinite(value))known.push(index);});
  if(!known.length)return new Array(out.length).fill(1);
  for(let i=0;i<known[0];i++)out[i]=out[known[0]];
  for(let i=known[known.length-1]+1;i<out.length;i++)out[i]=out[known[known.length-1]];
  for(let k=0;k<known.length-1;k++){
    const left=known[k],right=known[k+1],a=out[left],b=out[right];
    for(let i=left+1;i<right;i++){
      const weight=(i-left)/(right-left);
      out[i]=a+weight*(b-a);
    }
  }
  return out.map(value=>Number.isFinite(value)?value:1);
}

function normalizeRaw(rows){
  const out=[];
  for(const row of rows){
    const site=String(row.site??row.institution??'Site 1').trim();
    const admissionDate=M.dateKey(row.admission_date??row.admit_date??row.date);
    const los=Number(row.los_days??row.los??row.length_of_stay);
    const dischargeDate=M.dateKey(row.discharge_date);
    const event=row.event==null?1:Number(row.event);
    if(site&&admissionDate&&los>0)out.push({
      site,
      admission_date:admissionDate,
      discharge_date:dischargeDate,
      los_days:los,
      event:Number.isFinite(event)?event:1
    });
  }
  if(!out.length)throw new Error('Patient-stay CSV needs site, admission_date, and los_days columns.');
  return out.sort((a,b)=>a.site.localeCompare(b.site)||a.admission_date.localeCompare(b.admission_date));
}

function reconstructObserved(records,start,end){
  const map=new Map();
  for(const record of records){
    const discharge=record.discharge_date||M.addDays(record.admission_date,Math.max(1,Math.ceil(record.los_days)));
    for(let day=record.admission_date;day<discharge&&day<=end;day=M.addDays(day,1)){
      if(day<start)continue;
      map.set(day,(map.get(day)||0)+1);
    }
  }
  return map;
}

function processRawAdmissions(input,windowDays=null){
  const raw=normalizeRaw(input);
  const groups=new Map();
  raw.forEach(record=>{
    if(!groups.has(record.site))groups.set(record.site,[]);
    groups.get(record.site).push(record);
  });

  const daily=[],fitsInput={},configs=[];
  for(const[site,records]of groups){
    const start=records.reduce((minimum,record)=>record.admission_date<minimum?record.admission_date:minimum,records[0].admission_date);
    const observedEnd=records.reduce((maximum,record)=>record.admission_date>maximum?record.admission_date:maximum,start);
    const observedDays=M.daysBetween(start,observedEnd)+1;
    const requestedDays=Math.max(1,Math.round(Number(windowDays)||observedDays));
    const n=Math.min(observedDays,requestedDays);
    const end=M.addDays(start,n-1);
    const analysisRecords=records.filter(record=>record.admission_date<=end);
    const byDate=new Map();
    analysisRecords.forEach(record=>{
      if(!byDate.has(record.admission_date))byDate.set(record.admission_date,[]);
      byDate.get(record.admission_date).push(record.los_days);
    });

    const dates=[],counts=[],dailyMeanLos=[];
    for(let i=0;i<n;i++){
      const currentDate=M.addDays(start,i);
      const values=byDate.get(currentDate)||[];
      dates.push(currentDate);
      counts.push(values.length);
      dailyMeanLos.push(values.length?M.mean(values):NaN);
    }

    const filledMeanLos=fillMissing(dailyMeanLos);
    const admissionStl=chooseStl(counts);
    const losStl=chooseStl(filledMeanLos);
    const varianceChoice=chooseRollingVariance(losStl.residual);
    const observed=reconstructObserved(analysisRecords,start,end);
    const empiricalMeanLos=M.mean(analysisRecords.map(record=>record.los_days));
    const empiricalAdmissionRate=analysisRecords.length/n;

    for(let i=0;i<n;i++)daily.push({
      site,
      day:i+1,
      date:dates[i],
      year:Number(dates[i].slice(0,4)),
      day_of_year:M.dayOfYear(dates[i]),
      // The manuscript retains the STL trend component as lambda_t and mu_t.
      lambda_t:Math.max(0,admissionStl.trend[i]),
      mu_t:Math.max(0.01,losStl.trend[i]),
      sigma2_t:varianceChoice.variance[i],
      observed_occupancy:observed.get(dates[i])||0,
      admission_count:counts[i],
      raw_mean_los:Number.isFinite(dailyMeanLos[i])?dailyMeanLos[i]:null,
      historical_mean_los:empiricalMeanLos,
      historical_admission_rate:empiricalAdmissionRate
    });

    fitsInput[site]=analysisRecords;
    configs.push({
      site,
      admission_candidates_tested:admissionStl.candidatesTested,
      admission_residual_sd:admissionStl.score,
      admission_seasonal_window:admissionStl.config.seasonalWindow,
      admission_trend_window:admissionStl.config.trendWindow,
      admission_seasonal_degree:admissionStl.config.seasonalDegree,
      admission_trend_degree:admissionStl.config.trendDegree,
      admission_robust:admissionStl.config.robust,
      los_candidates_tested:losStl.candidatesTested,
      los_residual_sd:losStl.score,
      los_seasonal_window:losStl.config.seasonalWindow,
      los_trend_window:losStl.config.trendWindow,
      los_seasonal_degree:losStl.config.seasonalDegree,
      los_trend_degree:losStl.config.trendDegree,
      los_robust:losStl.config.robust,
      los_variance_window:varianceChoice.window,
      los_variance_stability_score:varianceChoice.score,
      empirical_mean_los:empiricalMeanLos,
      empirical_admission_rate:empiricalAdmissionRate
    });
  }

  return{daily,raw,fitsInput,configs};
}

return{
  STL_PERIOD,
  STL_GRID,
  VARIANCE_WINDOWS,
  localPoly,
  stlApprox,
  chooseStl,
  rollingStandardDeviation,
  chooseRollingVariance,
  normalizeRaw,
  processRawAdmissions
};
});
