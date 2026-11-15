import type { Fund, MetricDefinition } from '../types';
import { resolveBenchmark } from '../../config/benchmarks';
import { reasonMessage } from '../governance/reasonMessages';

export interface MetricFundInsight {
  whatItTellsYou: string;
  inContext: string;
}

const formatInr = (amount: number) =>
  `₹${Math.round(amount).toLocaleString('en-IN')}`;

export function explainMetricForFund(
  fund: Fund,
  metric: MetricDefinition,
  riskWindow = 3,
): MetricFundInsight {
  const id = metric.id;
  const val = fund.metrics?.[id];
  const subCat = fund.subCategory && fund.subCategory !== 'Uncategorized' ? fund.subCategory : `${fund.assetClass} scheme`;
  const resolution = resolveBenchmark(fund);
  const benchmarkName = resolution.ok ? resolution.benchmark.display_name : 'its category benchmark';
  const provenance = fund.metricProvenance?.[id];

  if (id === 'plan_type') {
    const isDirect = fund.plan === 'Direct';
    return {
      whatItTellsYou: metric.description,
      inContext: isDirect
        ? `This is a Direct plan — zero distributor commission is deducted from the NAV, so 100% of the portfolio's post-expense return stays invested for you.`
        : fund.plan === 'Regular'
          ? `This is a Regular plan — ongoing distributor trail commissions are deducted from the daily NAV, which compounds to a lower corpus over time compared to the Direct plan of the same scheme.`
          : `Plan type is ${fund.plan || 'not specified'} for this scheme.`,
    };
  }

  if (val == null || !Number.isFinite(val)) {
    const whyMissing =
      metric.availability === 'unavailable'
        ? 'This field is not yet available from a verified free public disclosure feed.'
        : `${reasonMessage(fund.metricReasonDetails?.[id], metric.label)}.`;
    return {
      whatItTellsYou: metric.description,
      inContext: `For a ${subCat} scheme, this metric helps you judge ${metric.group.toLowerCase()} characteristics, but no value is shown right now: ${whyMissing}`,
    };
  }

  switch (id) {
    case 'scheme_vintage_years': {
      const tier =
        val >= 10
          ? `With ${val.toFixed(1)} years of history, this ${subCat} fund is a battle-tested veteran that has navigated multiple bull markets, corrections, and RBI interest-rate cycles.`
          : val >= 5
            ? `At ${val.toFixed(1)} years old, this fund has a full market cycle of history — enough to evaluate its 3Y and 5Y rolling consistency with confidence.`
            : val >= 3
              ? `At ${val.toFixed(1)} years old, this scheme has completed its first 3-year cycle in ${subCat}, though longer 5Y/10Y multi-cycle data is still building.`
              : `At just ${val.toFixed(1)} years old, this is a relatively young ${subCat} scheme whose track record has not yet been tested across a full multi-year market cycle.`;
      return { whatItTellsYou: metric.description, inContext: tier };
    }

    case 'aum_cr': {
      const aumText = `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
      const isSmallMid = /small cap|mid cap/i.test(subCat);
      const sizeNote =
        val >= 25_000
          ? isSmallMid
            ? `At ${aumText}, this is a mega-sized ${subCat} fund — strong investor trust, though very large asset size in smaller companies can make entering and exiting nimble positions harder.`
            : `At ${aumText}, this is a flagship-scale ${subCat} scheme with deep liquidity and institutional scale.`
          : val >= 2_000
            ? `At ${aumText}, this scheme has healthy institutional scale in ${subCat} — large enough for cost efficiency without being bloated.`
            : val >= 300
              ? `At ${aumText}, this is a mid-sized ${subCat} fund with plenty of flexibility to deploy capital nimbly.`
              : `At ${aumText}, this is a smaller ${subCat} scheme — agile in trading, though single large institutional redemptions can have a bigger impact.`;
      return { whatItTellsYou: metric.description, inContext: sizeNote };
    }

    case 'ter_pct': {
      const annualCostPerLakh = Math.round(val * 1000);
      const isLow =
        fund.assetClass === 'equity'
          ? val <= 0.75
          : fund.assetClass === 'debt' || fund.assetClass === 'liquid'
            ? val <= 0.35
            : val <= 0.65;
      return {
        whatItTellsYou: metric.description,
        inContext: `A ${val.toFixed(2)}% TER means roughly ${formatInr(annualCostPerLakh)} per year is deducted on every ₹1,00,000 invested. For a ${fund.plan} ${subCat} scheme, this fee is ${isLow ? 'lean and cost-competitive, helping preserve compounding' : 'a meaningful ongoing drag that the manager must overcome through higher gross returns'}.`,
      };
    }

    case 'absolute_return_3m':
    case 'absolute_return_6m': {
      const months = id === 'absolute_return_3m' ? 3 : 6;
      const endedAt = 100_000 * (1 + val / 100);
      return {
        whatItTellsYou: metric.description,
        inContext: `Over the last ${months} months, ₹1,00,000 in this fund moved to ${formatInr(endedAt)} (${val >= 0 ? '+' : ''}${val.toFixed(2)}%). Use this to gauge short-term momentum in ${subCat}, not long-term compounding power.`,
      };
    }

    case 'cagr_1y':
    case 'cagr_3y':
    case 'cagr_5y':
    case 'cagr_10y': {
      const years = Number(id.replace('cagr_', '').replace('y', ''));
      const corpus = 100_000 * Math.pow(1 + val / 100, years);
      const peerSpreadId = `return_vs_subcategory_${years}y`;
      const peerSpread = fund.metrics?.[peerSpreadId];
      const peerClause =
        peerSpread != null && Number.isFinite(peerSpread)
          ? ` That is ${peerSpread >= 0 ? `${peerSpread.toFixed(2)}% per year ahead of` : `${Math.abs(peerSpread).toFixed(2)}% per year behind`} the median ${subCat} peer.`
          : '';
      return {
        whatItTellsYou: metric.description,
        inContext: `Compounding at ${val.toFixed(2)}% p.a. over ${years} year${years === 1 ? '' : 's'} turned ₹1,00,000 into ${formatInr(corpus)}.${peerClause}`,
      };
    }

    case 'rolling_3y_consistency':
    case 'rolling_5y_consistency': {
      const windowYr = id === 'rolling_3y_consistency' ? 3 : 5;
      const verdict =
        val >= 80
          ? `hitting the target in ${val.toFixed(1)}% of all historical ${windowYr}-year entry dates — a sign of dependable, all-weather performance rather than one lucky rally.`
          : val >= 55
            ? `beating the hurdle in ${val.toFixed(1)}% of ${windowYr}-year holding periods — solid, though entry timing still mattered during tougher market phases.`
            : `beating the hurdle in only ${val.toFixed(1)}% of ${windowYr}-year windows — returns have been lumpy and heavily dependent on when an investor entered.`;
      return {
        whatItTellsYou: metric.description,
        inContext: `For this ${subCat} scheme, rolling consistency is ${verdict}`,
      };
    }

    case 'rolling_3y_average_return': {
      const cagr3 = fund.metrics?.cagr_3y;
      const comparison =
        cagr3 != null && Number.isFinite(cagr3)
          ? cagr3 - val > 2
            ? ` Notice that today's trailing 3Y CAGR (${cagr3.toFixed(2)}%) is higher than its long-term rolling average (${val.toFixed(2)}%), meaning recent market strength has boosted current numbers.`
            : val - cagr3 > 2
              ? ` Its historical rolling average (${val.toFixed(2)}%) is stronger than the most recent 3Y window (${cagr3.toFixed(2)}%), suggesting the fund has historically compounded better than its latest phase.`
              : ` This closely matches its current 3Y CAGR (${cagr3.toFixed(2)}%), confirming that current returns reflect its typical long-term pace.`
          : '';
      return {
        whatItTellsYou: metric.description,
        inContext: `Across every historical 3-year holding period, an investor in this fund earned ${val.toFixed(2)}% p.a. on average.${comparison}`,
      };
    }

    case 'return_vs_subcategory_1y':
    case 'return_vs_subcategory_3y':
    case 'return_vs_subcategory_5y': {
      const years = id.endsWith('1y') ? 1 : id.endsWith('3y') ? 3 : 5;
      const status =
        val > 1.5
          ? `a clear category leader, outperforming the typical ${subCat} fund by +${val.toFixed(2)}% per year over ${years}Y.`
          : val >= 0
            ? `slightly ahead of the median ${subCat} peer by +${val.toFixed(2)}% per year over ${years}Y.`
            : val > -1.5
              ? `slightly trailing the median ${subCat} peer by ${val.toFixed(2)}% per year over ${years}Y.`
              : `lagging the typical ${subCat} fund by ${val.toFixed(2)}% per year over ${years}Y — worth checking if it took lower risk or struggled with stock selection.`;
      return {
        whatItTellsYou: metric.description,
        inContext: `Within ${subCat}, this scheme is ${status}`,
      };
    }

    case 'std_dev': {
      const catStd = fund.metrics?.category_std_dev;
      const peerCompare =
        catStd != null && Number.isFinite(catStd) && catStd > 0
          ? val < catStd * 0.92
            ? `Notably calmer than the ${subCat} peer median (${catStd.toFixed(2)}%), giving investors a smoother ride.`
            : val > catStd * 1.08
              ? `More volatile than the ${subCat} peer median (${catStd.toFixed(2)}%), meaning wider NAV swings in both rallies and corrections.`
              : `Right in line with the ${subCat} peer median volatility (${catStd.toFixed(2)}%).`
          : val < 3
            ? `Very low fluctuation (${val.toFixed(2)}%), typical of conservative debt or arbitrage strategies.`
            : `Annualized volatility is ${val.toFixed(2)}% over the ${riskWindow}Y window.`;
      return {
        whatItTellsYou: metric.description,
        inContext: `${peerCompare} In a normal year, this fund's return typically stays within ±${val.toFixed(1)}% of its average trend.`,
      };
    }

    case 'category_std_dev': {
      const ownStd = fund.metrics?.std_dev;
      return {
        whatItTellsYou: metric.description,
        inContext:
          ownStd != null && Number.isFinite(ownStd)
            ? `The typical ${subCat} peer fluctuates by ${val.toFixed(2)}% a year, whereas this specific scheme fluctuates by ${ownStd.toFixed(2)}% (${ownStd <= val ? 'calmer than peers' : 'more volatile than peers'}).`
            : `The typical scheme in ${subCat} experiences ${val.toFixed(2)}% annualized volatility.`,
      };
    }

    case 'max_drawdown': {
      const troughValue = 100_000 * (1 + val / 100);
      return {
        whatItTellsYou: metric.description,
        inContext: `During the worst sell-off in the ${riskWindow}Y window, a ₹1,00,000 investment at the peak temporarily fell to ${formatInr(troughValue)} (${val.toFixed(2)}%). Closer to 0% means better capital protection during market crashes.`,
      };
    }

    case 'var_95': {
      const lossPerLakh = Math.round((val / 100) * 100_000);
      return {
        whatItTellsYou: metric.description,
        inContext: `On 19 out of 20 trading days, this fund's single-day loss stayed within ${val.toFixed(2)}% (about ${formatInr(lossPerLakh)} per ₹1,00,000). Only the worst 5% of market days saw a sharper one-day drop.`,
      };
    }

    case 'semi_deviation': {
      const totalStd = fund.metrics?.std_dev;
      const ratioNote =
        totalStd != null && Number.isFinite(totalStd) && totalStd > 0
          ? val < totalStd * 0.68
            ? `Because downside volatility (${val.toFixed(2)}%) is much lower than total volatility (${totalStd.toFixed(2)}%), most of this fund's big moves were upward surges rather than painful drops.`
            : `Downside volatility is ${val.toFixed(2)}% against ${totalStd.toFixed(2)}% total volatility, showing how much of its fluctuation comes from negative days.`
          : `Downside-only volatility for this ${subCat} scheme is ${val.toFixed(2)}% over the ${riskWindow}Y window.`;
      return { whatItTellsYou: metric.description, inContext: ratioNote };
    }

    case 'tail_risk_ratio': {
      return {
        whatItTellsYou: metric.description,
        inContext:
          val >= 1.05
            ? `At ${val.toFixed(2)}, this fund's best rally days have been stronger than its worst crash days — a favorable positive skew for ${subCat} investors.`
            : val >= 0.9
              ? `At ${val.toFixed(2)}, extreme rally days and extreme sell-off days have been roughly balanced in size.`
              : `At ${val.toFixed(2)}, the fund's sharpest down-days have been larger than its best rally days, meaning sudden market sell-offs can hit harder than rallies bounce.`,
      };
    }

    case 'gain_loss_ratio': {
      return {
        whatItTellsYou: metric.description,
        inContext:
          val >= 1.05
            ? `At ${val.toFixed(2)}, the average winning day in this fund adds more value than the average losing day takes away.`
            : `At ${val.toFixed(2)}, average up-days and down-days are similar in size, so the fund relies on having more positive days than negative days to compound.`,
      };
    }

    case 'sharpe': {
      const quality =
        val >= 1.5
          ? `an exceptional risk-adjusted return — this fund has generated strong excess returns over the 5.55% risk-free rate with very controlled volatility.`
          : val >= 1.0
            ? `a strong risk-adjusted profile for a ${subCat} scheme — you are being well-compensated for the ups-and-downs taken.`
            : val >= 0.5
              ? `a moderate reward-to-risk balance over the ${riskWindow}Y window.`
              : val >= 0
                ? `a low reward per unit of volatility — the fund beat the 5.55% risk-free rate, but with a relatively bumpy ride.`
                : `negative excess return — over this ${riskWindow}Y window, the fund's return trailed the 5.55% FBIL MIBOR risk-free benchmark.`;
      return {
        whatItTellsYou: metric.description,
        inContext: `A Sharpe of ${val.toFixed(2)} indicates ${quality}`,
      };
    }

    case 'sortino': {
      const sharpe = fund.metrics?.sharpe;
      const vsSharpe =
        sharpe != null && Number.isFinite(sharpe)
          ? val > sharpe * 1.25
            ? ` Because Sortino (${val.toFixed(2)}) is significantly higher than Sharpe (${sharpe.toFixed(2)}), much of this fund's volatility came from healthy upside rallies rather than harmful drops.`
            : ` Comparing Sortino (${val.toFixed(2)}) with Sharpe (${sharpe.toFixed(2)}) shows how the fund manages downside drops relative to overall volatility.`
          : '';
      return {
        whatItTellsYou: metric.description,
        inContext: `At ${val.toFixed(2)}, this shows how much excess return (above 5.55% p.a.) the scheme earned for each unit of downside loss risk.${vsSharpe}`,
      };
    }

    case 'omega': {
      return {
        whatItTellsYou: metric.description,
        inContext:
          val >= 1.3
            ? `An Omega of ${val.toFixed(2)} means cumulative gains above the 5.55% risk-free hurdle have comfortably outweighed cumulative losses below it.`
            : val >= 1.0
              ? `An Omega of ${val.toFixed(2)} means gains above the risk-free threshold have outweighed losses, though by a modest margin.`
              : `An Omega below 1.0 (${val.toFixed(2)}) means downside misses below the risk-free hurdle outweighed upside gains during this window.`,
      };
    }

    case 'calmar': {
      return {
        whatItTellsYou: metric.description,
        inContext:
          val >= 1.0
            ? `At ${val.toFixed(2)}, this fund's annual return is higher than its worst peak-to-trough drawdown — meaning it historically earned back its worst crash in under a year.`
            : `At ${val.toFixed(2)}, it would take roughly ${val > 0 ? (1 / val).toFixed(1) : 'several'} years of normal annual return to recover from its deepest historical drawdown.`,
      };
    }

    case 'beta': {
      const sensitivity =
        val < 0.85
          ? `Noticeably defensive against ${benchmarkName}: when the benchmark moves 10%, this fund typically moves around ${(val * 10).toFixed(1)}%, helping cushion market corrections.`
          : val <= 1.08
            ? `Moves broadly in line with ${benchmarkName} (a 10% market move translates to roughly ${(val * 10).toFixed(1)}%), offering market-like sensitivity.`
            : `More aggressive than ${benchmarkName}: a 10% market swing typically drives a ${(val * 10).toFixed(1)}% move in this fund, amplifying both bull rallies and downturns.`;
      return {
        whatItTellsYou: metric.description,
        inContext: `With a Beta of ${val.toFixed(2)}, this ${subCat} scheme is ${sensitivity.charAt(0).toLowerCase() + sensitivity.slice(1)}`,
      };
    }

    case 'r_squared': {
      const pctFit = val <= 1 ? val * 100 : val;
      const style =
        pctFit >= 85
          ? `Around ${pctFit.toFixed(0)}% of this fund's daily moves mirror ${benchmarkName} — its risk/return behavior is closely tied to its category index.`
          : pctFit >= 60
            ? `About ${pctFit.toFixed(0)}% of the fund's moves track ${benchmarkName}, leaving meaningful room for active stock or duration positioning.`
            : `Only ${pctFit.toFixed(0)}% of this fund's movements are explained by ${benchmarkName}, showing a highly independent strategy whose Beta and Alpha should be read with extra care.`;
      return { whatItTellsYou: metric.description, inContext: style };
    }

    case 'treynor': {
      return {
        whatItTellsYou: metric.description,
        inContext: `At ${val.toFixed(2)}, this shows the excess return (above 5.55% p.a.) earned per unit of market sensitivity (Beta) against ${benchmarkName}. Higher values mean better reward for the market risk assumed.`,
      };
    }

    case 'jensen_alpha': {
      const verdict =
        val > 1.5
          ? `Generating +${val.toFixed(2)}% p.a. of true manager alpha over ${benchmarkName} after adjusting for Beta — strong evidence that active security selection is adding value.`
          : val >= 0
            ? `Delivering a positive +${val.toFixed(2)}% p.a. active edge above what passive exposure to ${benchmarkName} would explain.`
            : `At ${val.toFixed(2)}% p.a., the fund trailed the return expected for its level of market risk against ${benchmarkName} over the ${riskWindow}Y window.`;
      return { whatItTellsYou: metric.description, inContext: verdict };
    }

    case 'information_ratio': {
      const verdict =
        val >= 0.5
          ? `At ${val.toFixed(2)}, the manager has beaten ${benchmarkName} with high consistency relative to the active bets taken (above 0.50 is considered strong institutional skill).`
          : val >= 0
            ? `At ${val.toFixed(2)}, the fund has edged past ${benchmarkName}, though with moderate consistency relative to its tracking error.`
            : `At ${val.toFixed(2)}, active deviations from ${benchmarkName} have not yet paid off in excess return over this window.`;
      return { whatItTellsYou: metric.description, inContext: verdict };
    }

    case 'upside_capture': {
      const down = fund.metrics?.downside_capture;
      const spreadNote =
        down != null && Number.isFinite(down)
          ? val > down
            ? ` Combined with ${down.toFixed(0)}% downside capture, the fund captures more of the market's rallies than its drops — a healthy asymmetric profile.`
            : ` Compare this with its ${down.toFixed(0)}% downside capture to see the full bull-versus-bear trade-off.`
          : '';
      return {
        whatItTellsYou: metric.description,
        inContext: `When ${benchmarkName} rises, this fund captures ${val.toFixed(1)}% of the upside (${val >= 100 ? 'outpacing the index in rallies' : 'lagging slightly in fast bull rallies'}).${spreadNote}`,
      };
    }

    case 'downside_capture': {
      return {
        whatItTellsYou: metric.description,
        inContext:
          val < 90
            ? `At ${val.toFixed(1)}%, this fund absorbs noticeably less loss than ${benchmarkName} when markets fall — strong downside protection for ${subCat} investors.`
            : val <= 102
              ? `At ${val.toFixed(1)}%, the fund falls roughly in line with ${benchmarkName} during market pullbacks.`
              : `At ${val.toFixed(1)}%, the fund tends to fall harder than ${benchmarkName} during market sell-offs.`,
      };
    }

    case 'tracking_error': {
      const style =
        val < 1.5
          ? `At ${val.toFixed(2)}%, this scheme hugs ${benchmarkName} very closely — typical of index/passive funds or tightly benchmarked portfolios.`
          : val <= 5
            ? `At ${val.toFixed(2)}%, the manager takes measured active bets away from ${benchmarkName} while keeping benchmark drift controlled.`
            : `At ${val.toFixed(2)}%, this is a high-conviction active portfolio that can diverge significantly from ${benchmarkName} in any single year.`;
      return { whatItTellsYou: metric.description, inContext: style };
    }

    case 'benchmark_outperformance_ratio': {
      return {
        whatItTellsYou: metric.description,
        inContext: `This scheme beat ${benchmarkName} in ${val.toFixed(1)}% of rolling windows — ${val >= 60 ? 'showing repeatable outperformance across different market phases' : val >= 45 ? 'showing a balanced win-rate against its index' : 'indicating it has struggled to consistently stay ahead of its benchmark'}.`,
      };
    }

    case 'average_ytm':
    case 'category_ytm': {
      const catYtm = fund.metrics?.category_ytm;
      const ownYtm = fund.metrics?.average_ytm;
      const compare =
        id === 'average_ytm' && catYtm != null && Number.isFinite(catYtm)
          ? Math.abs(val - catYtm) < 0.05
            ? `Matches the ${subCat} reference yield (${catYtm.toFixed(2)}%).`
            : val > catYtm
              ? `Higher than the ${subCat} peer yield (${catYtm.toFixed(2)}%), which can boost accrual income but may reflect slightly lower-rated credit or longer maturity.`
              : `More conservative than the ${subCat} peer yield (${catYtm.toFixed(2)}%), typically indicating higher-grade sovereign/AAA holdings.`
          : ownYtm != null && Number.isFinite(ownYtm)
            ? `Provides the ${subCat} baseline (${val.toFixed(2)}%) to compare against this scheme's ${ownYtm.toFixed(2)}% YTM.`
            : `The ${subCat} reference yield is ${val.toFixed(2)}% p.a. before expenses.`;
      return { whatItTellsYou: metric.description, inContext: compare };
    }

    case 'average_maturity': {
      const sensitivity =
        val <= 1
          ? `At ${val.toFixed(1)} years, the portfolio holds short-term instruments with minimal interest-rate risk — ideal for parking money or low-volatility accrual.`
          : val <= 4
            ? `At ${val.toFixed(1)} years, this ${subCat} fund balances steady bond accrual with moderate sensitivity to RBI rate changes.`
            : `At ${val.toFixed(1)} years, this long-maturity portfolio is highly sensitive to interest rates — it can rally strongly when RBI cuts rates, but faces mark-to-market dips if yields rise.`;
      return { whatItTellsYou: metric.description, inContext: sensitivity };
    }

    case 'pe_ratio':
    case 'category_pe_ratio': {
      const catPe = fund.metrics?.category_pe_ratio;
      const ownPe = fund.metrics?.pe_ratio;
      const note =
        id === 'pe_ratio' && catPe != null && Number.isFinite(catPe)
          ? Math.abs(val - catPe) < 0.2
            ? `At ${val.toFixed(1)}x earnings, this portfolio is valued right in line with the ${subCat} benchmark (${catPe.toFixed(1)}x).`
            : val > catPe
              ? `At ${val.toFixed(1)}x vs the ${subCat} reference of ${catPe.toFixed(1)}x, this fund pays a premium for higher-growth or quality companies.`
              : `At ${val.toFixed(1)}x vs the ${subCat} reference of ${catPe.toFixed(1)}x, this fund leans toward more value-priced, lower-multiple companies.`
          : `At ${val.toFixed(1)}x earnings, this sets the valuation baseline for ${subCat} portfolios${ownPe != null ? ` (this fund is at ${ownPe.toFixed(1)}x)` : ''}.`;
      return { whatItTellsYou: metric.description, inContext: note };
    }

    default: {
      if (metric.group === 'Portfolio holdings') {
        const sourceTag =
          provenance === 'SEBI_HEURISTIC'
            ? 'reflecting the SEBI minimum category mandate floor for this category'
            : 'from scheme portfolio disclosures';
        return {
          whatItTellsYou: metric.description,
          inContext: `For this ${subCat} scheme, ${metric.label.toLowerCase()} is ${val.toFixed(1)}% (${sourceTag}), shaping how much of your money is exposed to this segment's risk and return drivers.`,
        };
      }
      return {
        whatItTellsYou: metric.description,
        inContext: `Current value for this ${subCat} scheme is ${val.toFixed(2)}${metric.unit === '%' ? '%' : ''}.`,
      };
    }
  }
}
