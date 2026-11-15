import type { MetricDefinition } from '../types';
import metricDirectionConfig from '../../../config/metric-directions.json';

const verifiedDefinitions: MetricDefinition[] = [
  {id:'plan_type',label:'Plan type',group:'Basics',unit:'enum',direction:'neutral',description:'Shows whether you are viewing the commission-free Direct plan or the distributor-led Regular plan of this scheme.',availability:'available'},
  {id:'scheme_vintage_years',label:'Scheme age',group:'Basics',unit:'years',direction:'neutral',description:'Shows how long this fund has been operating and how many full market cycles its track record covers.',availability:'computed'},
  {id:'aum_cr',label:'Average AUM · quarterly',group:'Cost & size',unit:'₹ Cr',direction:'neutral',description:'Shows the total investor money managed by this scheme — a gauge of scale, liquidity, and whether fund size could help or limit flexibility.',availability:'computed'},
  {id:'ter_pct',label:'TER',group:'Cost & size',unit:'%',direction:'lower',description:'The annual fee deducted from the fund’s NAV to cover management and operating costs; lower fees leave more return compounding for you.',availability:'computed'},
  ...[1,3,5,10].map((n):MetricDefinition=>({id:`cagr_${n}y`,label:`${n}Y CAGR`,group:'Returns',unit:'%',direction:'higher',description:`Shows the steady annual compounding rate an investor earned by holding this fund over the last ${n} year${n===1?'':'s'}.`,availability:'computed'})),
  {id:'rolling_3y_consistency',label:'Rolling 3Y consistency',group:'Consistency',unit:'%',direction:'higher',description:'Shows how reliably this fund beat the return hurdle across every 3-year holding period, regardless of which day you invested.',availability:'computed'},
  {id:'rolling_5y_consistency',label:'Rolling 5Y consistency',group:'Consistency',unit:'%',direction:'higher',description:'Shows how consistently this fund rewarded long-term investors across every 5-year holding window, removing lucky start-date bias.',availability:'computed'},
  {id:'benchmark_outperformance_ratio',label:'Benchmark outperformance',group:'Benchmark-relative',unit:'%',direction:'higher',description:'Shows how often this fund beat its category benchmark across rolling holding periods — a measure of repeatable active management.',availability:'computed'},
  ...[
    ['std_dev','Volatility (annualized std dev)','Risk','lower','Shows how widely this fund’s returns swing from year to year; lower volatility means a smoother, more predictable holding experience.'],
    ['max_drawdown','Max drawdown','Risk','higher','Shows the worst peak-to-bottom drop an investor had to endure during the period — a real-world test of how much temporary loss this fund can experience in a downturn.'],
    ['var_95','VaR 95%','Risk','lower','Shows the worst single-day drop you would typically see on 95% of trading days, helping you gauge routine bad-day volatility.'],
    ['semi_deviation','Semi-deviation','Risk','lower','Measures only the fund’s downward fluctuations, showing how turbulent the fund gets specifically when markets are falling.'],
    ['tail_risk_ratio','Tail risk ratio','Risk','higher','Compares the fund’s best rally days against its worst crash days; above 1.0 means extreme upside days have been stronger than extreme sell-offs.'],
    ['gain_loss_ratio','Gain/loss ratio','Risk-adjusted','higher','Compares the size of an average up-day to an average down-day, showing whether winning days pack more punch than losing days.'],
    ['sharpe','Sharpe','Risk-adjusted','higher','Shows how much extra return this fund delivered for every unit of volatility taken above the 5.55% risk-free rate — higher means a smoother reward for the risk endured.'],
    ['sortino','Sortino','Risk-adjusted','higher','Shows how well the fund rewards you relative to harmful downside drops only, without penalizing positive upward surges.'],
    ['omega','Omega','Risk-adjusted','higher','Shows whether total gains above the risk-free rate outweigh total losses below it across all days; higher values indicate stronger odds of beating a safe deposit.'],
    ['calmar','Calmar','Risk-adjusted','higher','Compares annual compounding return against the fund’s worst historical drop, showing how quickly the fund’s growth recovers from deep corrections.'],
    ['beta','Beta','Benchmark-relative','neutral','Shows how sensitive this fund is to market swings: below 1.0 cushions market drops, 1.0 moves in line with the index, and above 1.0 amplifies market moves.'],
    ['r_squared','R-squared','Benchmark-relative','neutral','Shows how closely this fund’s movements are explained by its benchmark index versus independent stock or bond selection.'],
    ['treynor','Treynor','Benchmark-relative','higher','Shows how much excess return this fund generated for each unit of market sensitivity (Beta) it took on.'],
    ['jensen_alpha','Jensen alpha','Benchmark-relative','higher','Shows the extra annual return added by the fund manager’s security selection beyond what passive market exposure (Beta) alone would deliver.'],
    ['information_ratio','Information ratio','Benchmark-relative','higher','Shows how consistently the fund manager beats the benchmark relative to how far the portfolio deviates from the index.'],
    ['upside_capture','Upside capture','Benchmark-relative','higher','Shows how much of the benchmark’s gains this fund captures when markets rise; above 100% means the fund outpaces the index in bull rallies.'],
    ['downside_capture','Downside capture','Benchmark-relative','lower','Shows how much of the benchmark’s losses this fund absorbs when markets fall; below 100% means the fund protects capital better than the index in sell-offs.'],
    ['tracking_error','Tracking error','Benchmark-relative','lower','Shows how much this fund’s return path diverges from its benchmark — near zero for index funds, higher for high-conviction active funds.'],
  ].map(([id,label,group,direction,description]):MetricDefinition=>({id:id!,label:label!,group:group!,unit:id==='tail_risk_ratio'||id==='gain_loss_ratio'||id==='sharpe'||id==='sortino'||id==='omega'||id==='calmar'||id==='beta'||id==='treynor'||id==='information_ratio'?'ratio':'%',direction:direction as MetricDefinition['direction'],description:description!,availability:'computed'})),
];

const unavailable=(id:string,label:string,group:string,unit:MetricDefinition['unit'],description:string):MetricDefinition=>({id,label,group,unit,direction:'neutral',description,availability:'unavailable'});
const requestedMarkers: MetricDefinition[] = [
  {id:'return_vs_subcategory_1y',label:'Return vs sub-category · 1Y',group:'Peer-relative',unit:'%',direction:'higher',description:'Shows how much this fund beat or trailed the typical (median) fund in the exact same AMFI category over the past year.',availability:'computed'},
  {id:'return_vs_subcategory_3y',label:'Return vs sub-category · 3Y',group:'Peer-relative',unit:'%',direction:'higher',description:'Shows how much annual return this fund added or lost compared to the median peer in its category over 3 years.',availability:'computed'},
  {id:'return_vs_subcategory_5y',label:'Return vs sub-category · 5Y',group:'Peer-relative',unit:'%',direction:'higher',description:'Shows whether this fund has been a long-term category leader or laggard relative to same-category peers over 5 years.',availability:'computed'},
  unavailable('return_vs_subcategory_10y','Return vs sub-category · 10Y','Peer-relative','%','Shows how this fund performed relative to its AMFI sub-category peers over a full 10-year decade.'),
  {id:'absolute_return_3m',label:'Absolute return · 3M',group:'Returns',unit:'%',direction:'higher',description:'Shows how this fund performed over the last 3 months — useful for spotting recent momentum or reaction to current market events.',availability:'computed'},
  {id:'absolute_return_6m',label:'Absolute return · 6M',group:'Returns',unit:'%',direction:'higher',description:'Shows total return over the past 6 months, reflecting how the portfolio has navigated the latest half-year market trend.',availability:'computed'},
  {id:'rolling_3y_average_return',label:'3Y average annual rolling return',group:'Consistency',unit:'%',direction:'higher',description:'Shows the typical 3-year annualized return an investor earned across all historical entry dates, smoothing out single-date luck.',availability:'computed'},
  {id:'category_ytm',label:'Category YTM',group:'Fixed income',unit:'%',direction:'higher',description:'Shows the typical gross yield to maturity across peer debt funds in this category, giving you a baseline to judge whether this fund is reaching for higher yield.',availability:'computed'},
  {id:'average_ytm',label:'Average YTM',group:'Fixed income',unit:'%',direction:'higher',description:'Shows the expected annual gross yield of the fund’s bond portfolio if held to maturity before expenses; higher yield vs peers can indicate higher credit or duration risk.',availability:'computed'},
  {id:'average_maturity',label:'Average maturity',group:'Fixed income',unit:'years',direction:'neutral',description:'Shows the average time until the fund’s bonds mature — longer maturity makes the fund more sensitive to RBI interest-rate cuts and hikes.',availability:'computed'},
  {id:'pe_ratio',label:'PE ratio',group:'Valuation',unit:'ratio',direction:'lower',description:'Shows how expensive the stocks in this fund’s portfolio are relative to their earnings — higher P/E indicates a growth/quality tilt, while lower P/E signals a value tilt.',availability:'computed'},
  {id:'category_pe_ratio',label:'Category PE ratio',group:'Valuation',unit:'ratio',direction:'lower',description:'Shows the typical valuation multiple of peer funds in this category so you can see if this fund is priced at a premium or discount to peers.',availability:'computed'},
  {id:'category_std_dev',label:'Category standard deviation','group':'Peer-relative',unit:'%',direction:'lower',description:'Shows the typical annual volatility of funds in this AMFI category so you can judge whether this scheme is calmer or more aggressive than its peers.',availability:'computed'},
  {id:'equity_holding_pct',label:'Equity holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Shows the share of the portfolio invested in stocks — the primary driver of long-term capital growth and market volatility.',availability:'computed'},
  {id:'debt_holding_pct',label:'Debt holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Shows the share of the portfolio held in bonds and money-market instruments to generate income and cushion equity market swings.',availability:'computed'},
  {id:'largecap_holding_pct',label:'Large-cap holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Shows the allocation to India’s top 100 established companies by market cap, which typically provide stability and higher liquidity.',availability:'computed'},
  {id:'midcap_holding_pct',label:'Mid-cap holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Shows the allocation to mid-sized companies (ranked 101–250), which offer higher growth potential than large-caps with moderate-to-high volatility.',availability:'computed'},
  {id:'smallcap_holding_pct',label:'Small-cap holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Shows the allocation to smaller, faster-growing companies (ranked 251+), which can boost bull-market returns but fall sharper in corrections.',availability:'computed'},
  {id:'sovereign_debt_pct',label:'Sovereign debt holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Shows the allocation to Government of India and State bonds that carry zero credit-default risk.',availability:'computed'},
  {id:'corporate_debt_pct',label:'Corporate debt holding',group:'Portfolio holdings',unit:'%',direction:'neutral',description:'Shows the allocation to company bonds and debentures that offer higher yields than government securities in exchange for credit exposure.',availability:'computed'},
  unavailable('cash_holding_pct','Cash holding','Portfolio holdings','%','Shows how much of the portfolio is sitting in cash or overnight equivalents — either as dry powder for opportunities or to meet redemptions.'),
  unavailable('top_10_concentration_pct','Top 10 holdings concentration','Portfolio holdings','%','Shows how much of the fund rides on its top 10 bets — high concentration means high conviction, while lower concentration means broader diversification.'),
];

const definitions: MetricDefinition[] = [...verifiedDefinitions,...requestedMarkers];

type DirectionConfig = { direction: 'higher' | 'lower' | 'none'; rationale: string };
const configuredDirections = metricDirectionConfig as Record<string, DirectionConfig>;
const configuredDefinitions = definitions.map((definition): MetricDefinition => {
  const configuration = configuredDirections[definition.id];
  if (!configuration) throw new Error(`Missing metric direction configuration for ${definition.id}`);
  return { ...definition, direction: configuration.direction === 'none' ? 'neutral' : configuration.direction };
});

export const metricRegistry = configuredDefinitions;
export const metricById = Object.fromEntries(configuredDefinitions.map((metric) => [metric.id, metric]));
