const M=require('../js/math.js');
const D=require('../js/distributions.js');
const P=require('../js/preprocessing.js');
const Model=require('../js/model.js');

function ok(condition,message){if(!condition)throw new Error(message);}
function close(actual,expected,tolerance,message){
  if(Math.abs(actual-expected)>tolerance)throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

// Core distribution formulas.
close(D.survival(10,'Exponential',10,100,1),Math.exp(-1),1e-9,'exponential survival');
const fiskMean=10,fiskKappa=2,fiskScale=fiskMean/(Math.PI/fiskKappa);
close(D.survival(5,'Fisk',fiskMean,0,fiskKappa),Math.pow(fiskScale/(5+fiskScale),fiskKappa),1e-12,'manuscript Fisk/Burr survival');

// The manuscript grid contains exactly 72 STL configurations.
const smoothSeries=Array.from({length:90},(_,i)=>2+0.25*Math.sin(2*Math.PI*i/7));
const stl=P.chooseStl(smoothSeries);
ok(stl.candidatesTested===72,'STL grid should evaluate 72 configurations');
ok(stl.trend.length===smoothSeries.length,'STL trend length');

// The rolling-variance selector evaluates 7, 15, and 31 days and uses the
// longer window to break an exact stability tie.
const varianceChoice=P.chooseRollingVariance(new Array(90).fill(0));
ok(varianceChoice.window===31,'zero-residual tie should select 31-day variance window');
ok(varianceChoice.variance.every(value=>value===1e-6),'variance floor');

// End-to-end patient-stay preprocessing.
const raw=[];
const start=new Date('2025-01-01T00:00:00Z');
for(let i=0;i<90;i++){
  const date=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
  raw.push({site:'Site 1',admission_date:date,los_days:5});
  raw.push({site:'Site 1',admission_date:date,los_days:15});
}
const processed=P.processRawAdmissions(raw);
ok(processed.daily.length===90,'raw preprocessing should create one row per day');
ok(processed.configs[0].admission_candidates_tested===72,'admission grid count');
ok(processed.configs[0].los_candidates_tested===72,'LOS grid count');
close(M.mean(processed.daily.map(row=>row.lambda_t)),2,1e-6,'constant admission trend');
close(M.mean(processed.daily.map(row=>row.mu_t)),10,1e-6,'constant LOS trend');

// Occupancy and capacity calculations.
const rows=Array.from({length:250},(_,i)=>({site:'Test',day:i+1,lambda_t:2,mu_t:10,sigma2_t:100,admission_count:2}));
const rho=Model.occupancy(rows,{distribution:'Exponential',kappa:1,smax:100});
const steady=M.mean(rho.slice(-40));
close(steady,2/(1-Math.exp(-0.1)),0.1,'discrete exponential steady state');

const baseline=Model.analyze(rows,{distributionMode:'manual',distribution:'Exponential',kappa:1,smax:100,gamma:1,riskRule:'average daily risk',arrivalMultiplier:1,meanLosMultiplier:1},{});
const higher=Model.analyze(rows,{distributionMode:'manual',distribution:'Exponential',kappa:1,smax:100,gamma:1,riskRule:'average daily risk',arrivalMultiplier:1.1,meanLosMultiplier:1},{});
ok(baseline.summary.length===1,'one-site summary');
ok(higher.summary[0].B_average>baseline.summary[0].B_average,'higher demand should increase Baverage');

// Uploaded-data results must not depend on whether a site is called Site 1 or Hospital A.
const recordsA=raw.map(row=>({...row,site:'Site 1'}));
const recordsB=raw.map(row=>({...row,site:'Hospital A'}));
const pA=P.processRawAdmissions(recordsA),pB=P.processRawAdmissions(recordsB);
const fA=D.fitAll(pA.fitsInput['Site 1']),fB=D.fitAll(pB.fitsInput['Hospital A']);
close(fA.best.rmse,fB.best.rmse,1e-12,'fit RMSE must be site-label independent');
ok(fA.best.name===fB.best.name,'selected distribution must be site-label independent');

console.log('All tests passed.');
