"""
Emo Materialist Habit Tracker — Streamlit shell.

Streamlit's only job here is to serve the HTML/CSS/JS app full-screen.
Everything else (auth, settings, themes, Supabase) is handled entirely
inside index.html / style.css / script.js.

The sidebar, header bar, and all Streamlit chrome are hidden via CSS.
"""

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="Emo Materialist Habit Tracker",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Hide ALL Streamlit chrome: sidebar, header bar, footer, deploy button.
# We use our own UI built into the HTML/CSS/JS, so none of this is needed.
st.markdown("""
<style>
[data-testid="stSidebar"] { display: none !important; }
[data-testid="stHeader"] { display: none !important; }
[data-testid="stToolbar"] { display: none !important; }
footer { display: none !important; }
#MainMenu { display: none !important; }
[data-testid="stAppViewContainer"] {
    padding: 0 !important;
    margin: 0 !important;
}
[data-testid="stVerticalBlock"] {
    padding: 0 !important;
    gap: 0 !important;
}
.block-container {
    padding: 0 !important;
    max-width: 100% !important;
}
iframe {
    display: block;
    border: none;
}
</style>
""", unsafe_allow_html=True)


def load_app_html():
    """
    Reads index.html, style.css, script.js and bundles them into one
    self-contained HTML string for components.html.
    The HTML already has <link> and <script> tags pointing to the files,
    so we inline them here since components.html can't load separate files.
    """
    with open("index.html", "r", encoding="utf-8") as f:
        html = f.read()
    with open("style.css", "r", encoding="utf-8") as f:
        css = f.read()
    with open("script.js", "r", encoding="utf-8") as f:
        js = f.read()

    # Replace file references with inlined content
    html = html.replace(
        '<link rel="stylesheet" href="style.css">',
        f"<style>{css}</style>",
    )
    html = html.replace(
        '<script src="script.js" defer></script>',
        f"<script defer>{js}</script>",
    )
    return html


components.html(
    load_app_html(),
    height=900,
    scrolling=True,
)
