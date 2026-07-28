(function(root,factory){const api=factory(typeof require==='function'?require('./math.js'):root.NICUMath,typeof require==='function'?require('./distributions.js'):root.NICUDistributions);if(typeof module==='object'&&module.exports)module.exports=api;root.NICUModel=api;})(typeof self!=='undefined'?self:this,function(M,D){
'use strict';

const PRESETS={
  'Site 1':{distribution:'Fisk',kappa:1.34,smax:325,rmse:0.01},
  'Site 2':{distribution:'Fisk',kappa:1.54,smax:116,rmse:0.03},
  'Site 3':{distribution:'Exponential',kappa:null,smax:57,rmse:0.02},
  'Site 4':{distribution:'Exponential',kappa:null,smax:61,rmse:0.01},
  'Site 5':{distribution:'Weibull',kappa:0.97,smax:52,rmse:0.02}
};

function group(rows){
  const grouped=new Map();
  rows.forEach(row=>{
    if(!grouped.has(row.site))grouped.set(row.site,[]);
    grouped.get(row.site).push({...row});
  });
  grouped.forEach(siteRows=>siteRows.sort((a,b)=>a.day-b.day));
  return grouped;
}

function siteSettings(site,settings,fits){
  if(settings.distributionMode==='presets'&&PRESETS[site])return{...settings,...PRESETS[site]};
  if(settings.distributionMode==='auto'&&fits&&fits[site]){
    const fit=fits[site];
    return{
      ...settings,
      distribution:fit.name,
      kappa:fit.kappa==null?null:fit.kappa,
      smax:fit.smax,
      rmse:fit.rmse??null,
      empiricalMeanLos:fit.empiricalMeanLos??fit.empiricalMean??null
    };
  }
  return{
    ...settings,
    distribution:settings.distribution||'Lognormal',
    kappa:Number(settings.kappa||1.5),
    smax:Number(settings.smax||60)
  };
}

function applyScenario(rows,settings){
  const arrivalMultiplier=Number(settings.arrivalMultiplier||1);
  const meanLosMultiplier=Number(settings.meanLosMultiplier||1);
  const varianceMultiplier=Number(settings.varianceMultiplier||1);
  const start=settings.scenarioStart||null,end=settings.scenarioEnd||null;
  return rows.map(row=>{
    const key=row.date||String(row.day);
    const inside=(!start||key>=start)&&(!end||key<=end);
    return{
      ...row,
      lambda_t:row.lambda_t*(inside?arrivalMultiplier:1),
      mu_t:row.mu_t*(inside?meanLosMultiplier:1),
      sigma2_t:row.sigma2_t*(inside?varianceMultiplier:1)
    };
  });
}

function occupancy(rows,settings){
  const rho=new Array(rows.length).fill(0);
  const smax=Math.max(1,Math.floor(settings.smax));
  for(let t=0;t<rows.length;t++){
    let expected=0;
    for(let u=0;u<=Math.min(smax,t);u++){
      const row=rows[t-u];
      expected+=row.lambda_t*D.survival(u,settings.distribution,row.mu_t,row.sigma2_t,settings.kappa);
    }
    rho[t]=expected;
  }
  return rho;
}

function bAverage(rows,settings={}){
  const hasObservedCounts=rows.some(row=>Number.isFinite(Number(row.admission_count)));
  const baseAdmissionValues=rows.map(row=>hasObservedCounts?Number(row.admission_count):Number(row.lambda_t));
  const scenarioArrivalMultiplier=hasObservedCounts?Number(settings.arrivalMultiplier||1):1;
  const lambdaBar=M.mean(baseAdmissionValues)*scenarioArrivalMultiplier;
  let meanLos=Number(settings.empiricalMeanLos);
  if(!Number.isFinite(meanLos)||meanLos<=0){
    const weightedNumerator=M.sum(rows.map(row=>{
      const count=Number.isFinite(Number(row.admission_count))?Number(row.admission_count):1;
      const rawMean=Number(row.raw_mean_los);
      return Number.isFinite(rawMean)?count*rawMean:0;
    }));
    const weightedDenominator=M.sum(rows.map(row=>Number.isFinite(Number(row.raw_mean_los))?(Number(row.admission_count)||1):0));
    meanLos=weightedDenominator>0?weightedNumerator/weightedDenominator:M.mean(rows.map(row=>row.mu_t));
  }
  meanLos*=Number(settings.meanLosMultiplier||1);
  const rhoBar=lambdaBar*meanLos;
  return{beds:Math.ceil(rhoBar+Math.sqrt(Math.max(0,rhoBar))),rhoBar,lambdaBar,meanLos};
}

function bMax(rho){
  const peak=Math.max(...rho);
  return Math.ceil(peak+Math.sqrt(Math.max(0,peak)));
}

function overflowRisk(rho,beds,gamma,rule){
  const threshold=Math.floor(gamma*beds);
  const risks=rho.map(expected=>1-M.poissonCdf(threshold,expected));
  return rule==='max daily risk'?Math.max(...risks):M.mean(risks);
}

function overflowCapacity(rho,gamma,alpha,rule){
  let low=1,high=Math.max(2,Math.ceil(Math.max(...rho)/Math.max(gamma,0.01)));
  while(overflowRisk(rho,high,gamma,rule)>alpha&&high<20000)high*=2;
  while(low<high){
    const middle=Math.floor((low+high)/2);
    if(overflowRisk(rho,middle,gamma,rule)<=alpha)high=middle;else low=middle+1;
  }
  return low;
}

function observedMetrics(rows,capacities){
  if(!rows.some(row=>Number.isFinite(row.observed_occupancy)))return[];
  const out=[];
  for(const[strategy,beds]of Object.entries(capacities)){
    const utilization=rows.map(row=>100*Number(row.observed_occupancy||0)/beds);
    const over=utilization.filter(value=>value>100),under=utilization.filter(value=>value<70);
    out.push({
      strategy,
      beds,
      mean_utilization:M.mean(utilization),
      sd_utilization:M.std(utilization,true),
      pct_days_over_100:100*over.length/utilization.length,
      mean_excess_over_100:over.length?M.mean(over.map(value=>value-100)):0,
      pct_days_under_70:100*under.length/utilization.length,
      mean_shortfall_under_70:under.length?M.mean(under.map(value=>70-value)):0
    });
  }
  return out;
}

function analyze(rows,settings,fits){
  const summary=[],daily=[],utilization=[],weights={};
  for(const[site,rawRows]of group(rows)){
    const siteConfig=siteSettings(site,settings,fits);
    const siteRows=applyScenario(rawRows,settings);
    const rho=occupancy(siteRows,siteConfig);
    const average=bAverage(siteRows,siteConfig);
    const capacities={
      actual_beds:Number((settings.actualBeds||{})[site])||null,
      B_average:average.beds,
      'B_0.05':overflowCapacity(rho,Number(settings.gamma||1),0.05,settings.riskRule||'average daily risk'),
      'B_0.01':overflowCapacity(rho,Number(settings.gamma||1),0.01,settings.riskRule||'average daily risk'),
      B_max:bMax(rho)
    };
    const naive=Math.ceil(Math.max(...siteRows.map(row=>row.lambda_t*row.mu_t)));
    summary.push({
      site,
      distribution:siteConfig.distribution,
      kappa:siteConfig.kappa==null?null:siteConfig.kappa,
      smax:siteConfig.smax,
      los_fit_rmse:siteConfig.rmse??null,
      rho_bar:average.rhoBar,
      historical_admission_rate:average.lambdaBar,
      historical_mean_los:average.meanLos,
      mean_rho_t:M.mean(rho),
      peak_rho_t:Math.max(...rho),
      B_naive_peak:naive,
      ...capacities
    });
    siteRows.forEach((row,index)=>daily.push({...row,rho_t:rho[index],B_naive_peak:naive,...capacities}));
    weights[site]=M.sum(siteRows.map(row=>Number(row.admission_count??row.lambda_t)));
    observedMetrics(siteRows,Object.fromEntries(Object.entries(capacities).filter(([,value])=>Number.isFinite(value)))).forEach(metric=>utilization.push({site,...metric}));
  }

  const strategies=[...new Set(utilization.map(row=>row.strategy))];
  for(const strategy of strategies){
    const rowsForStrategy=utilization.filter(row=>row.strategy===strategy&&row.site!=='Weighted system');
    const totalWeight=M.sum(rowsForStrategy.map(row=>weights[row.site]||0));
    if(!totalWeight)continue;
    const weightedMean=M.sum(rowsForStrategy.map(row=>(weights[row.site]||0)*row.mean_utilization))/totalWeight;
    const weightedSd=Math.sqrt(M.sum(rowsForStrategy.map(row=>(weights[row.site]||0)*(row.mean_utilization-weightedMean)**2))/totalWeight);
    utilization.push({site:'Weighted system',strategy,beds:null,mean_utilization:weightedMean,sd_utilization:weightedSd,pct_days_over_100:null,mean_excess_over_100:null,pct_days_under_70:null,mean_shortfall_under_70:null});
  }
  return{summary,daily,utilization};
}

function sensitivity(rows,settings,fits,betas){
  const out=[];
  for(const[site,rawRows]of group(rows)){
    const siteConfig=siteSettings(site,settings,fits);
    const baseRho=occupancy(rawRows,siteConfig);
    const base={
      'B_0.05':overflowCapacity(baseRho,settings.gamma,0.05,settings.riskRule),
      'B_0.01':overflowCapacity(baseRho,settings.gamma,0.01,settings.riskRule),
      B_max:bMax(baseRho)
    };
    for(const beta of betas){
      const changed=rawRows.map(row=>({...row,sigma2_t:row.sigma2_t*beta}));
      const rho=occupancy(changed,siteConfig);
      const values={
        'B_0.05':overflowCapacity(rho,settings.gamma,0.05,settings.riskRule),
        'B_0.01':overflowCapacity(rho,settings.gamma,0.01,settings.riskRule),
        B_max:bMax(rho)
      };
      for(const[strategy,beds]of Object.entries(values))out.push({site,strategy,beta,beds,pct_change:100*(beds-base[strategy])/base[strategy]});
    }
  }
  return out;
}

function synthetic(days=365){
  const config=[
    ['Site 1',1.6,0.25,8,0],
    ['Site 2',3.2,0.20,9.5,20],
    ['Site 3',2.4,0.18,8.4,55],
    ['Site 4',2.6,0.22,8.6,80],
    ['Site 5',1.5,0.20,7.8,120]
  ];
  const out=[];
  for(const[site,base,amplitude,meanLos,phase]of config){
    for(let t=0;t<days;t++){
      const lambda=Math.max(0.001,base*(1+amplitude*Math.sin(2*Math.PI*(t+phase)/365)));
      const mu=Math.max(0.01,meanLos*(1+0.1*Math.sin(2*Math.PI*(t+60+phase)/365)));
      out.push({
        site,
        day:t+1,
        date:null,
        year:null,
        day_of_year:t+1,
        lambda_t:lambda,
        mu_t:mu,
        sigma2_t:mu*mu,
        observed_occupancy:null,
        admission_count:lambda
      });
    }
  }
  return out;
}

return{PRESETS,siteSettings,applyScenario,occupancy,bAverage,bMax,overflowCapacity,analyze,sensitivity,synthetic,group};
});
