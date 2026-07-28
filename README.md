# NICU Capacity Planner

A GitHub Pages–compatible dashboard for ICU/NICU bed occupancy and capacity planning using an \(M_t/G_t/\infty\) queueing model.

The clinical-facing interface is designed for nurses, physicians, and healthcare planners. It emphasizes a simple workflow:

**Upload data → compare demand scenarios → review the recommended capacity → download results**

## Run locally

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000
```

## Data formats

### Patient-stay data

```csv
site,admission_date,los_days
Site 1,2023-01-01,8.5
Site 1,2023-01-02,12.0
Site 2,2023-01-02,6.5
```

The former `event` column was removed from the test file because each row already represents an observed admission with a completed LOS value.

### Processed daily data

```csv
site,day,lambda_t,mu_t,sigma2_t
Site 1,1,1.7,8.1,36.0
Site 1,2,1.6,8.0,35.5
Site 2,1,3.2,9.1,42.0
```

## Current interface

- Automatic preprocessing of raw patient-stay data
- Automatic LOS distribution fitting for uploaded raw data
- Lower, current, and higher demand scenarios
- Expected occupancy, utilization, and capacity-by-site graphs
- Baverage, B0.05, B0.01, and Bmax capacity estimates
- B0.05 highlighted as the recommended default planning strategy
- Capacity summary, daily occupancy, LOS fitting, scenario comparison, and graph downloads
- Target average utilization defaulted to 0.85
- Browser-local data processing for the GitHub Pages deployment

## GitHub Pages

Publish from:

```text
main → /(root)
```

After the site is configured, pushing changes to `main` automatically updates the same deployed website.

## Data privacy

Uploaded files are processed locally in the visitor's browser and are not stored by the website. Do not upload identifiable or confidential patient data to a public or shared device.

## Authors

- **Ali R. Baloach** — ali.baloach@ucalgary.ca
- **Maryam Akbari-Moghaddam** — maryam.moghaddam@ucalgary.ca
- **Douglas G. Down** — downd@mcmaster.ca
- **Catherine Eastwood** — caeastwo@ucalgary.ca
- **Ayman Abou Mehrem** — a.aboumehrem@ucalgary.ca
- **Alexandra Howlett** — alixe.howlett@albertahealthservices.ca
- **Na Li** — Na.Li@ucalgary.ca

## Associated manuscript

*Data-Driven Bed Occupancy Planning in Intensive Care Units Using \(M_t/G_t/\infty\) Queueing Models*

## License

Apache License 2.0. See `LICENSE`.


## Clinical Interface Layout

The current interface uses one main Overview page. Automatic preprocessing and LOS fitting run in the browser, the three primary graphs remain visible, and all CSV and PNG downloads are available directly on the main page.
