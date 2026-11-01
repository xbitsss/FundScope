import type { MetricDefinition } from '../types';

const verifiedDefinitions: MetricDefinition[] = [
  {id:'plan_type',label:'Plan type',group:'Basics',unit:'enum',direction:'neutral',description:'Direct or Regular plan.',availability:'available'},
  {id:'scheme_vintage_years',label:'Scheme age',group:'Basics',unit:'years',direction:'neutral',description:'Years since the first observed NAV.',availability:'computed'},
  {id:'aum_cr',label:'Average AUM · quarterly',group:'Cost & size',unit:'₹ Cr',direction:'neutral',description:'Latest quarterly scheme-wise Average AUM (AAUM) reported by AMFI, or an audited local override.',availability:'computed'},
  {id:'ter_pct',label:'TER',group:'Cost & size',unit:'%',direction:'lower',description:'Total expense ratio from an AMFI disclosure or audited local override.',availability:'computed'},
  ...[1,3,5,10].map((n):MetricDefinition=>({id:`cagr_${n}y`,label:`${n}Y CAGR`,group:'Returns',unit:'%',direction:'higher',description:`Annualized growth over ${n} years from observed Growth-option NAV history.`,availability:'computed'})),
  {id:'rolling_3y_consistency',label:'Rolling 3Y consistency',group:'Consistency',unit:'%',direction:'higher',description:'Share of available rolling 3-year windows that beat the configured hurdle.',availability:'computed'},
  {id:'rolling_5y_consistency',label:'Rolling 5Y consistency',group:'Consistency',unit:'%',direction:'higher',description:'Share of available rolling 5-year windows that beat the configured hurdle.',availability:'computed'},
  {id:'benchmark_outperformance_ratio',label:'Benchmark outperformance',group:'Benchmark-relative',unit:'%',direction:'higher',description:'Unavailable until a validated benchmark series is configured.',availability:'unavailable'},
  ...[
    ['std_dev','Volatility (annualized std dev)','Risk','lower','Annualized standard deviation of daily returns from the locally stored NAV history.'],
    ['max_drawdown','Max drawdown','Risk','higher','Largest peak-to-trough decline in the selected risk window, stored as a negative percentage (closer to zero is better).'],
    ['var_95','VaR 95%','Risk','lower','Historical daily 95% loss quantile.'],
    ['semi_deviation','Semi-deviation','Risk','lower','Annualized deviation of returns below zero.'],
    ['tail_risk_ratio','Tail risk ratio','Risk','higher','Mean loss in the worst 5% of daily returns divided by mean daily return.'],
    ['gain_loss_ratio','Gain/loss ratio','Risk-adjusted','higher','Average positive daily return divided by the absolute average negative daily return.'],
    ['sharpe','Sharpe','Risk-adjusted','higher','Annualized excess return divided by annualized standard deviation. Uses the configured risk-free rate.'],
    ['sortino','Sortino','Risk-adjusted','higher','Annualized excess return divided by annualized downside deviation.'],
    ['omega','Omega','Risk-adjusted','higher','Probability-weighted gains above the hurdle divided by losses below it.'],
    ['calmar','Calmar','Risk-adjusted','higher','Annualized return divided by absolute maximum drawdown.'],
    ['beta','Beta','Benchmark-relative','neutral','OLS beta against the configured proxy using aligned daily returns.'],
    ['r_squared','R-squared','Benchmark-relative','neutral','Regression fit against the configured proxy.'],
    ['treynor','Treynor','Benchmark-relative','higher','Annualized excess return divided by proxy beta.'],
    ['jensen_alpha','Jensen alpha','Benchmark-relative','higher','Annualized CAPM alpha against the configured proxy.'],
    ['information_ratio','Information ratio','Benchmark-relative','higher','Annualized active return divided by active risk.'],
    ['upside_capture','Upside capture','Benchmark-relative','higher','Fund return divided by proxy return on positive proxy days.'],
    ['downside_capture','Downside capture','Benchmark-relative','lower','Fund return divided by proxy return on negative proxy days.'],
    ['tracking_error','Tracking error','Benchmark-relative','lower','Annualized standard deviation of daily active returns.'],
  ].map(([id,label,group,direction,description]):MetricDefinition=>({id:id!,label:label!,group:group!,unit:id==='tail_risk_ratio'||id==='gain_loss_ratio'||id==='sharpe'||id==='sortino'||id==='omega'||id==='calmar'||id==='beta'||id==='treynor'||id==='information_ratio'?'ratio':'%',direction:direction as MetricDefinition['direction'],description:description!,availability:'computed'})),
];

const unavailable=(id:string,label:string,group:string,unit:MetricDefinition['unit'],description:string):MetricDefinition=>({id,label,group,unit,direction:'neutral',description,availability:'unavailable'});
const requestedMarkers: MetricDefinition[] = [
  {id:'return_vs_subcategory_1y',label:'Return vs sub-category · 1Y',group:'Peer-relative',unit:'%',direction:'higher',description:'Fund one-year CAGR minus the median local peer CAGR in the same sub-category.',availability:'computed'},
  {id:'return_vs_subcategory_3y',label:'Return vs sub-category · 3Y',group:'Peer-relative',unit:'%',direction:'higher',description:'Fund three-year CAGR minus the median local peer CAGR in the same sub-category.',availability:'computed'},
  {id:'return_vs_subcategory_5y',label:'Return vs sub-category · 5Y',group:'Peer-relative',unit:'%',direction:'higher',description:'Fund five-year CAGR minus the median local peer CAGR in the same sub-category.',availability:'computed'},
  unavailable('return_vs_subcategory_10y','Return vs sub-category · 10Y','Peer-relative','%','Return relative to the matched AMFI sub-category over ten years. Requires a verified category return series.'),
  {id:'absolute_return_3m',label:'Absolute return · 3M',group:'Returns',unit:'%',direction:'higher',description:'Three-month NAV return, computed locally from cached daily NAV history.',availability:'computed'},
  {id:'absolute_return_6m',label:'Absolute return · 6M',group:'Returns',unit:'%',direction:'higher',description:'Six-month NAV return, computed locally from cached daily NAV history.',availability:'computed'},
  {id:'rolling_3y_average_return',label:'3Y average annual rolling return',group:'Consistency',unit:'%',direction:'higher',description:'Arithmetic mean of available rolling three-year CAGRs from cached NAV history.',availability:'computed'},
  unavailable('category_ytm','Category YTM','Fixed income','%','Category yield to maturity. Requires a verified category disclosure feed.'),
  unavailable('average_ytm','Average YTM','Fixed income','%','Portfolio weighted yield to maturity. Requires a verified portfolio disclosure feed.'),
  unavailable('average_maturity','Average maturity','Fixed income','years','Portfolio weighted average maturity. Requires a verified portfolio disclosure feed.'),
  unavailable('pe_ratio','PE ratio','Valuation','ratio','Portfolio price-to-earnings ratio. Requires a verified portfolio disclosure feed.'),
  unavailable('category_pe_ratio','Category PE ratio','Valuation','ratio','Sub-category price-to-earnings ratio. Requires a verified category disclosure feed.'),
  {id:'category_std_dev',label:'Category standard deviation','group':'Peer-relative',unit:'%',direction:'lower',description:'Median annualized volatility across active funds in the same asset class and AMFI sub-category, computed from each fund’s local NAV history.',availability:'computed'},
  {id:'equity_holding_pct',label:'Equity holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Reported holding when available; otherwise a SEBI category mandate floor, clearly labelled as a heuristic.',availability:'computed'},
  ...[
    ['debt_holding_pct','Debt holding'],['largecap_holding_pct','Large-cap holding'],['midcap_holding_pct','Mid-cap holding'],['smallcap_holding_pct','Small-cap holding'],['sovereign_debt_pct','Sovereign debt holding'],['corporate_debt_pct','Corporate debt holding'],
  ].map(([id,label]):MetricDefinition=>({id:id!,label:label!,group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Reported holding when available; otherwise a SEBI category mandate floor, clearly labelled as a heuristic.',availability:'computed'})),
  unavailable('cash_holding_pct','Cash holding','Portfolio holdings','%','Share of assets held in cash. Requires a verified portfolio disclosure feed.'),
  unavailable('top_10_concentration_pct','Top 10 holdings concentration','Portfolio holdings','%','Share of assets in the ten largest holdings. Requires a verified portfolio disclosure feed.'),
];

const definitions: MetricDefinition[] = [...verifiedDefinitions,...requestedMarkers];

export const metricRegistry = definitions;
export const metricById = Object.fromEntries(definitions.map((metric) => [metric.id, metric]));
