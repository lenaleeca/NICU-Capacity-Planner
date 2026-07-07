import pandas as pd
from flask import Flask, jsonify, request, render_template
from .model import make_synthetic_all_sites, validate_daily_inputs
from .capacity import analyze_sites, variance_sensitivity

app = Flask(__name__, template_folder="../templates", static_folder="../static")
LAST_OUTPUTS = {}


def serialize_df(df):
    return df.where(pd.notnull(df), None).to_dict(orient="records")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/sample", methods=["GET"])
def sample_csv():
    df = make_synthetic_all_sites(days=365)
    return df.to_csv(index=False), 200, {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=sample_daily_inputs.csv"
    }


@app.route("/api/run", methods=["POST"])
def run_model():
    try:
        distribution = request.form.get("distribution", "Lognormal")
        smax = int(float(request.form.get("smax", 60)))
        kappa = float(request.form.get("kappa", 1.5))
        gamma = float(request.form.get("gamma", 0.85))
        risk_rule = request.form.get("risk_rule", "average daily risk")
        mode = request.form.get("mode", "synthetic")

        if mode == "upload" and "file" in request.files and request.files["file"].filename:
            df = pd.read_csv(request.files["file"])
            df = validate_daily_inputs(df)
        else:
            days = int(float(request.form.get("days", 365)))
            df = make_synthetic_all_sites(days=days)

        summary, out = analyze_sites(df, distribution, smax, kappa, gamma, risk_rule)

        beta_raw = request.form.get("betas", "0,0.2,0.5,0.8,1,1.2,1.5,1.8")
        betas = [float(x.strip()) for x in beta_raw.split(",") if x.strip()]
        sens = variance_sensitivity(df, distribution, smax, kappa, gamma, risk_rule, betas)

        LAST_OUTPUTS["daily"] = out
        LAST_OUTPUTS["summary"] = summary
        LAST_OUTPUTS["sensitivity"] = sens

        return jsonify({
            "ok": True,
            "summary": serialize_df(summary),
            "daily": serialize_df(out),
            "sensitivity": serialize_df(sens),
            "settings": {
                "distribution": distribution,
                "smax": smax,
                "kappa": kappa,
                "gamma": gamma,
                "risk_rule": risk_rule,
            }
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/download/<name>", methods=["GET"])
def download(name):
    if name not in LAST_OUTPUTS:
        return "No output has been generated yet.", 404
    return LAST_OUTPUTS[name].to_csv(index=False), 200, {
        "Content-Type": "text/csv",
        "Content-Disposition": f"attachment; filename={name}.csv"
    }


if __name__ == "__main__":
    app.run(debug=True)
