# Preferans bot research and training report

Date: 2026-10-25

## Outcome and active policy

The bot now combines stronger imperfect-information search with a trained hand-value network for ordinary-contract discard and contract selection. `src/bot.ts` selects the trained wrapper in `src/ai-trained.ts`; `src/ai.ts` remains the independently runnable search policy and fallback. Auction, whist, misère and card play use that search policy. The network does **not** directly replace auction decisions or play every card.

The following comparisons support this choice:

| Comparison | Independent deals | Matched seat comparisons | Total score improvement | Better / tied / worse |
|---|---:|---:|---:|---:|
| Final active policy vs original `b542e19`, fresh seeds 90001–90024 | 24 | 72 | +302.67 whists | 29 / 30 / 13 |
| Improved search vs original `b542e19`, seeds 40001–40048 | 48 | 144 | +776.68 whists | 52 / 62 / 30 |
| Trained candidate vs improved search, development seeds 50001–50024 | 24 | 72 | +145.34 whists | 4 / 67 / 1 |
| Trained candidate vs improved search, fresh seeds 80001–80024 | 24 | 72 | +85.34 whists | 2 / 70 / 0 |

The final active policy averages +4.20 whists per seat comparison against the original. The search-only comparison averages +5.39 on a different set of deals. The trained candidate's independent comparison against search averages +1.19. These are separate experiments against different baselines and layouts; **their totals cannot be added**, and the different averages do not constitute a direct comparison between final and search-only policies. The neural candidate changes relatively few decisions, so its measured gain is preliminary. This is evidence of improvement against these opponents, not a tournament-strength rating or an estimated human win rate.

Full numeric results, including regressions and rejected experiments, are in [simulation-results.json](simulation-results.json). Model prediction metrics and provenance are in [training-results.json](training-results.json).

## Research and implications

1. **Trade against the alternative, not just contract success probability.** V. G. Ilyichev's [“Probability theory and the main question of Preferans”](https://www.mathnet.ru/php/getFT.phtml?jrnid=mo&paperid=664&what=fullt) examines when taking the kitty is preferable to passing, including hands without six obvious tricks. Its numerical examples concern Rostov; they were not copied into this game's Sochi scoring. The implication here is to evaluate actual expected score rather than reward bidding frequency.
2. **Position, entries and joint defense matter.** O. Skuratov's [Preferans strategy text](https://thelib.ru/books/skuratov_o/preferans_istoriya_strategiya_taktika-read-5.html) gives examples involving deliberate losses, preservation of entries, coordinated defense and whist responsibility. This informed tactical checks and the separation of ordinary defense from misère defense. The book discusses multiple conventions; this implementation retains its existing rules.
3. **Inference and bidding deserve their own models.** [Buro et al., 2009](https://webdocs.cs.ualberta.ca/~nathanst/papers/skat.pdf) combine learned evaluation and inference about unobserved hands in Skat. [Rebstock et al., 2019](https://arxiv.org/abs/1905.10907) study learned bidding and game declaration, including expected-value selection. Skat is a useful research analogue, not the same game: rules and payoffs differ.
4. **Independent perfect-information worlds can produce incompatible plans.** [Cowling, Powley and Whitehouse, 2012](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf) describe this problem and information-set MCTS. The hard bot now shares a public-action tree between sampled worlds, with legal-action availability counts. This does not remove every imperfect-information approximation; rollouts and endgame analysis still use sampled worlds.
5. **Self-play learning is a credible longer-term route.** [DouZero](https://proceedings.mlr.press/v139/zha21a.html) demonstrates strong learned play in another three-player card game. The present work is supervised learning from simulated search-bot outcomes, **not** a complete DouZero-style reinforcement-learning system. [Deep CFR](https://proceedings.mlr.press/v97/brown19b.html) is another relevant research direction, but its poker results do not establish equilibrium guarantees for this three-player game with changing partnerships.

## Search improvements

- Hard mode uses single-observer information-set MCTS in earlier play, with up to 1800 iterations and a 900 ms outer search budget.
- Endgames with at most 15 remaining cards use sampled minimax for contracts or three-player max-n for raspasy. Equivalent adjacent ranks are pruned inside fixed-world searches, not at the real root decision.
- Payoffs use the same scoring implementation as real deals: pool, hill, whists, responsibility penalties, misère losses and the raspasy zero-trick bonus. `outcomeScores` evaluates hypothetical outcomes without changing the live game.
- Each raspasy player optimizes their own outcome. The opponents are not modeled as a permanent coalition against the observing player.
- Sampling observes public kitty cards, known voids and a soft prior from the winning bid. Implausible hands retain nonzero probability to allow adventurous bidding.
- Simulated ordinary defense considers partner's card and whether declarer can cover in third hand. Misère defense tries to force declarer to take, rather than treating the defenders as ordinary trick winners.
- Hard whist and half-whist decisions compare 48 sampled outcomes with their actual scoring and an estimated response from the other defender.
- Bidding simulates unknown kitties and discard opportunities, subject to a structural guard against optimistic simulations. Long side suits contribute to the structural estimate. Contract selection no longer inherently prefers six over a justified higher contract.
- Search branches copy only mutable play fields, avoiding repeated copies of accumulated match records.

## Dataset

The final dataset contains **24,000 independently seeded simulated deals**:

| Purpose | Examples |
|---|---:|
| Training | 19,200 |
| Validation / checkpoint and temperature selection | 2,400 |
| Reserved prediction test | 2,400 |

The generators produced 6000 examples with seeds 1000001–1006000 and another 18,000 with seeds 2000001–2018000. Each example is one deal, so the random split does not put observations from the same deal into multiple sets. Arena seeds are separate from all of these.

The teacher is the current **medium** search bot, using up to 16 hidden-information samples per decision. All three seats use their own legitimate observations. The generator forces an ordinary six-trick contract and two whists to collect a completed trick-count label for every example. Trump selection mixes the bidder's long/strong suits, other suits and no-trump. Most discards use the structural policy; a subset use alternative discards to broaden coverage.

The label is declarer's actual final trick count. Hidden hands are needed by the simulator to run a deal, but are **not inputs to the learned model**. The model sees:

- declarer's ten retained cards;
- declarer's two known discarded cards;
- trump / no-trump;
- opening position relative to declarer.

This teacher is weaker than the final hard search. Forced six-trick games also do not perfectly represent the risk choices made during higher contracts. Both are limitations of this pilot dataset.

The compressed dataset is stored in [training/hand-value-data.jsonl.gz](training/hand-value-data.jsonl.gz). The uncompressed data SHA-256 is:

```text
b315490c859571f910f11f0ce65bd92c4cf7167ebc9315eaf178e9dbb9a69057
```

## Network and fitting

Suit canonicalization shares learned rank patterns across equivalent suits. Trump is first when present; side suits are ordered by length, retained ranks and discarded ranks. For each suit the input includes eight retained-card bits, eight discarded-card bits, normalized length, a top sequence and a bottom sequence. Four additional features encode no-trump and relative opening position: **80 inputs** in total.

The network is **80 → 96 → 48 → 11**, with ReLU hidden layers and 0.12 dropout after the first hidden layer: 12,971 parameters. The eleven softmax outputs represent probabilities of taking 0–10 tricks.

Fitting used CPU PyTorch 2.11.0 and NumPy 2.3.5, random seed 719, AdamW with learning rate 0.0015 and weight decay 0.015, batches of 256, and cross entropy with label smoothing 0.02. Validation controls checkpoint selection and early stopping. The best checkpoint was epoch 41, counted from zero. Validation-selected temperature was 1.0. No test examples were used for gradient updates.

Weights are exported to [src/hand-model.ts](src/hand-model.ts), rounded to six decimals. Browser inference requires no Python service or external API. A PyTorch reference prediction is included in the artifact and checked against the TypeScript implementation.

### Reserved prediction results

| Metric | Final network | Unconditional training-set prior |
|---|---:|---:|
| Mean absolute trick-count error | 0.888 | 1.731 |
| Negative log likelihood | 1.479 | 2.150 |
| Brier score for taking at least six tricks | 0.105 | — |

The unconditional prior is a simple diagnostic baseline, **not the existing heuristic bot**. Prediction improvements alone do not establish stronger play; arena comparisons are the promotion test.

## Using the learned value

The learned policy compares ordinary contracts using a conservative declarer-score proxy with a two-whist assumption. This is an approximation, including conservative treatment of rare high contracts, rather than the exact settlement routine used by card search. For discard, it considers the eight highest structural candidates and requires at least three predicted whists of advantage before replacing the structural discard. This limits selection of unusual hands whose model values may be unreliable. Very strong, rare hands retain search-based treatment, including the guaranteed-ten-trick regression fixture.

Auction, whist, opening, misère and card play delegate to the stronger search bot. The pilot does not include an independent learned auction policy, learned whist policy, or neural move policy. The active worker imports `src/bot.ts`, allowing a tested candidate to be selected without deleting the search baseline.

## Experiments that were rejected

| Experiment | Prediction result | Arena result vs stronger search | Decision |
|---|---|---:|---|
| 6000 examples; own-hand-only features | MAE 0.948; NLL 1.584 | −46.67 whists / 72 comparisons, seeds 50001–50024 | Rejected |
| 6000 examples; added private-discard features | MAE 0.969; NLL 1.576 | −15.99 / 72, seeds 60001–60024 | Rejected |
| 24,000 examples; constrained learned discard only | MAE 0.888; NLL 1.479 | +104.67 / 72, development seeds 50001–50024 | Positive ablation |
| 24,000 examples; constrained discard and learned contract | Same model | +145.34 / 72 on development deals; +85.34 / 72 on fresh deals | Selected locally |

An earlier search-only prototype is also a useful caution: isolated tests showed 6.5% fewer raspasy tricks and more bids, but a full competitive test lost **77.31 whists over 72 comparisons**. It was revised. More bidding and a higher contract-success percentage are not the overall objective.

## Arena method and limitations

For each seeded layout, a control game uses three baseline bots. Three additional games replace one seat at a time with the candidate. Auctions, discard, contracts, whist, open-hand control and card play run through the actual engine. Opening position rotates. Candidate comparisons use the same cards and random-number initialization where the paths coincide.

Results are measured in whists. An unfinished pool is valued by applying `totals` to `hill - pool`; this accounts for the remaining pool obligation. These are independent-deal score estimates, not completed-pool match win percentages. The three seat comparisons on one layout are correlated. Time-limited search can vary between machines.

The search champion was additionally tested on identical forced-contract positions, twelve layouts per type:

| Forced contract | Seat comparisons | Score delta vs original |
|---|---:|---:|
| Six spades | 36 | **−86.65** |
| Seven no-trump | 36 | +6.68 |
| Misère | 36 | +1499.97 |
| Raspasy | 36 | +86.67 |

The six-spade regression is a real unresolved weakness of this sample. Overall gains do **not** mean every game type improved. Forced contracts include poor and sometimes unrealistic declarations; the large misère score change is sensitive to costly undertricks and should not be interpreted as an expert-misère rating. The neural wrapper delegates card play to this same search policy.

The final learned comparison improved only two of 72 fresh comparisons and tied the rest. Larger independent leagues, multiple opponent families, realistic expert misère fixtures and targeted trump-play analysis remain necessary before claiming robust or expert-level strength. No statistical confidence interval or exploitability guarantee is claimed.

## Reproduction

Install JavaScript dependencies normally and Python training dependencies from `scripts/requirements-training.txt`. Tests and the production build are:

```sh
npm test
npm run build
```

Fit the included dataset without regenerating games:

```sh
gzip -dc training/hand-value-data.jsonl.gz > /tmp/preferans-training-combined.jsonl
TRAIN_DATA=/tmp/preferans-training-combined.jsonl npm run training:fit
```

Alternatively regenerate both seed blocks and concatenate them:

```sh
TRAIN_GAMES=6000 TRAIN_SEED=1000001 TRAIN_DATA=/tmp/preferans-a.jsonl npm run training:data
TRAIN_GAMES=18000 TRAIN_SEED=2000001 TRAIN_DATA=/tmp/preferans-b.jsonl npm run training:data
cat /tmp/preferans-a.jsonl /tmp/preferans-b.jsonl > /tmp/preferans-training-combined.jsonl
TRAIN_DATA=/tmp/preferans-training-combined.jsonl npm run training:fit
```

Evaluate the active policy against the original bot, or the learned policy against the retained search implementation:

```sh
EVAL_DEALS=48 SUITE_DEALS=12 EVAL_SEED=40001 EVAL_OUTPUT=/tmp/preferans-evaluation.json npm run evaluate
CANDIDATE_MODULE=ai-trained BASELINE_FILE=src/ai.ts EVAL_DEALS=24 SUITE_DEALS=0 EVAL_SEED=80001 npm run evaluate
CANDIDATE_MODULE=ai-trained CANDIDATE_EXPORT=botActionDiscard BASELINE_FILE=src/ai.ts EVAL_DEALS=24 SUITE_DEALS=0 EVAL_SEED=50001 npm run evaluate
```

To reproduce the search-only comparison against the original, add `CANDIDATE_MODULE=ai` to the first arena command. `BASELINE_REF` selects a historical commit. Experiments compile isolated temporary module snapshots, so later source edits do not change an experiment already running.

`TRAJECTORIES=/tmp/preferans-selfplay.jsonl npm run evaluate` also exports masked observations, chosen actions, policy identifiers and final rewards for future training. All rows with the same deal seed must stay in the same dataset split. The next substantive training step is a stronger-teacher / self-play league, with wider action coverage, held-out opponents, and promotion based on score rather than prediction accuracy alone.

## Verification

All **35 tests pass**, and the production build passes with the selected worker policy. The suite covers legal play and full deals, hidden-card independence, unrevealed kitty independence, whist privacy, non-mutating hypothetical scoring, endgame tactics, preservation of a winning lead, forcing a misère catch, suit invariance and Python/TypeScript inference parity. The included compressed dataset was decompressed and checked against its SHA-256 and 24,000-row count. Results are also recorded with the machine-readable experiment results.

Publication uses the repository's existing main-branch GitHub Pages workflow after successful tests and build.
