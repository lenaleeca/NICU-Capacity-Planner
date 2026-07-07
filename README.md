# NICU Capacity Planner

A one-page Flask + HTML/CSS/JavaScript dashboard implementing an Mt/Gt/∞ ICU/NICU bed occupancy planning model.

## Install

```bash
pip install -r requirements.txt
```

## Run

From the project folder:

```bash
python -m backend.app
```

Then open:

```text
http://127.0.0.1:5000
```

## CSV input format

```csv
site,day,lambda_t,mu_t,sigma2_t
Site 1,1,1.7,8.1,36.0
Site 1,2,1.6,8.0,35.5
Site 2,1,3.2,9.1,42.0
```

This uses processed model inputs rather than patient-level data.

## Author

Ali BALOACH: ali.baloach@ucalgary.ca
Na Li: Na.Li@ucalgary.ca

