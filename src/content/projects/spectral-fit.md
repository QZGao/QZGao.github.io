---
title: spectral_fit
summary: A Python package for fitting and comparing pulsar radio-spectrum models with Bayesian inference.
year: '2024'
category: academic
order: 1
links:
  - label: Source code
    url: https://github.com/QZGao/spectral_fit
---

`spectral_fit` is the research codebase behind [Bayesian statistical analysis of 897 pulsar flux density spectra](/research/bayesian-pulsar-spectra/). It assembles calibrated flux-density measurements from the `pulsar-spectra` catalogue and additional literature, while excluding source material that lacks calibration information. The result is a documented dataset and fitting pipeline rather than a collection of isolated model scripts.

The pipeline compares simple and broken power laws, log-parabolic spectra, high-frequency cut-offs, low-frequency turnovers, and double-turnover models. It supports Cauchy and Gaussian likelihoods, configurable priors, alternative treatments of outliers and systematic uncertainty, and an AIC-based frequentist workflow for comparison with the Bayesian analysis.

Command-line controls cover catalogue selection, individual pulsars, model sets, uncertainty assumptions, multiprocessing, checkpoints, and plotting. Post-processing tools extract model evidence, AIC values, parameter estimates, and goodness-of-fit statistics, and can regenerate frequency–flux and posterior diagnostic plots. These pieces preserve the choices behind the published analysis and make alternative assumptions straightforward to test.
