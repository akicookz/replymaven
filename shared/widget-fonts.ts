// Catalog of widget/help fonts. A font is a family name plus faces. Presets
// are canned face lists; a custom upload later is the same shape on the project.
// One emitter (fontFaceCss) produces @font-face for both.

export interface WidgetFontFace {
  src: string;
  /** Single cut, or a variable range such as [400, 700] so 600 interpolates. */
  weight: number | readonly [number, number];
  style?: "normal" | "italic";
}

export interface WidgetFontOption {
  value: string;
  label: string;
  /** Empty for system-ui (no file). */
  faces: readonly WidgetFontFace[];
}

function variable(
  src: string,
  weight: readonly [number, number] = [400, 700],
): WidgetFontFace[] {
  return [{ src, weight, style: "normal" }];
}

function google(src: string): WidgetFontFace[] {
  return variable(src, [400, 700]);
}

// Projects that still store "Lato" keep working after it left the picker.
const WIDGET_FONT_ALIASES: Record<string, string> = {
  Lato: "Instrument Sans",
};

export const WIDGET_FONTS: WidgetFontOption[] = [
  { value: "system-ui", label: "System Default", faces: [] },
  {
    value: "DM Sans",
    label: "DM Sans",
    faces: google(
      "https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K6z9mXg.woff2",
    ),
  },
  {
    value: "Figtree",
    label: "Figtree",
    faces: google(
      "https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4S9DaRvzig.woff2",
    ),
  },
  {
    value: "Geist",
    label: "Geist",
    faces: google(
      "https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2",
    ),
  },
  {
    value: "IBM Plex Sans",
    label: "IBM Plex Sans",
    faces: google(
      "https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYbSB4Zh.woff2",
    ),
  },
  {
    value: "Instrument Sans",
    label: "Instrument Sans",
    faces: google(
      "https://fonts.gstatic.com/s/instrumentsans/v4/pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1ZuWi3g.woff2",
    ),
  },
  {
    value: "Inter",
    label: "Inter",
    faces: google(
      "https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2",
    ),
  },
  {
    value: "JetBrains Mono",
    label: "JetBrains Mono",
    faces: google(
      "https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2",
    ),
  },
  {
    value: "Karla",
    label: "Karla",
    faces: google(
      "https://fonts.gstatic.com/s/karla/v33/qkB9XvYC6trAT55ZBi1ueQVIjQTD-JrIH2G7nytkHRyQ8p4wUje6bmMorHA.woff2",
    ),
  },
  {
    value: "Lora",
    label: "Lora",
    faces: google(
      "https://fonts.gstatic.com/s/lora/v37/0QIvMX1D_JOuMwr7I_FMl_E.woff2",
    ),
  },
  {
    value: "Manrope",
    label: "Manrope",
    faces: google(
      "https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSvfedN4.woff2",
    ),
  },
  {
    value: "Merriweather Sans",
    label: "Merriweather Sans",
    faces: google(
      "https://fonts.gstatic.com/s/merriweathersans/v28/2-c99IRs1JiJN1FRAMjTN5zd9vgsFHX1QjXp8Bte.woff2",
    ),
  },
  {
    value: "Montserrat",
    label: "Montserrat",
    faces: google(
      "https://fonts.gstatic.com/s/montserrat/v31/JTUSjIg1_i6t8kCHKm459WlhyyTh89Y.woff2",
    ),
  },
  {
    value: "Nunito",
    label: "Nunito",
    faces: google(
      "https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaBTMnFcQ.woff2",
    ),
  },
  {
    value: "Open Sans",
    label: "Open Sans",
    faces: google(
      "https://fonts.gstatic.com/s/opensans/v44/memvYaGs126MiZpBA-UvWbX2vVnXBbObj2OVTS-mu0SC55I.woff2",
    ),
  },
  {
    value: "Outfit",
    label: "Outfit",
    faces: google(
      "https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2",
    ),
  },
  {
    value: "Playfair Display",
    label: "Playfair Display",
    faces: google(
      "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFiD-vYSZviVYUb_rj3ij__anPXDTzYgEM86xQ.woff2",
    ),
  },
  {
    value: "Plus Jakarta Sans",
    label: "Plus Jakarta Sans",
    faces: google(
      "https://fonts.gstatic.com/s/plusjakartasans/v12/LDIoaomQNQcsA88c7O9yZ4KMCoOg4Ko20yygg_vb.woff2",
    ),
  },
  // Poppins has no variable axis; load the static 600 file so semibold is real.
  {
    value: "Poppins",
    label: "Poppins",
    faces: [
      {
        src: "https://fonts.gstatic.com/s/poppins/v24/pxiEyp8kv8JHgFVrJJfecnFHGPc.woff2",
        weight: 400,
      },
      {
        src: "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLGT9Z1xlFd2JQEk.woff2",
        weight: 500,
      },
      {
        src: "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLEj6Z1xlFd2JQEk.woff2",
        weight: 600,
      },
      {
        src: "https://fonts.gstatic.com/s/poppins/v24/pxiByp8kv8JHgFVrLCz7Z1xlFd2JQEk.woff2",
        weight: 700,
      },
    ],
  },
  {
    value: "Raleway",
    label: "Raleway",
    faces: google(
      "https://fonts.gstatic.com/s/raleway/v37/1Ptug8zYS_SKggPNyC0IT4ttDfA.woff2",
    ),
  },
  {
    value: "Roboto",
    label: "Roboto",
    faces: google(
      "https://fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBHMdazQ.woff2",
    ),
  },
  {
    value: "Rubik",
    label: "Rubik",
    faces: google(
      "https://fonts.gstatic.com/s/rubik/v31/iJWKBXyIfDnIV7nBrXyw023e.woff2",
    ),
  },
  {
    value: "Satoshi",
    label: "Satoshi",
    faces: variable(
      "https://cdn.fontshare.com/wf/NWBQYJIM7GCZ5XWD7D26ARB3VDY55ZRT/K63EV2KZIGKLE7RANQ2U42S6SVHU5RJ7/X6XYTKIVDUW7GZTZPZNN4EUM5KH54KHF.woff2",
      [300, 900],
    ),
  },
  {
    value: "Sora",
    label: "Sora",
    faces: google(
      "https://fonts.gstatic.com/s/sora/v17/xMQ9uFFYT72X5wkB_18qmnndmSdSnh2BAfO5mnuyOo1lfiQwV6-xo6eeIw.woff2",
    ),
  },
  {
    value: "Source Sans 3",
    label: "Source Sans 3",
    faces: google(
      "https://fonts.gstatic.com/s/sourcesans3/v19/nwpStKy2OAdR1K-IwhWudF-R3w8aZejf5Hc.woff2",
    ),
  },
  {
    value: "Space Grotesk",
    label: "Space Grotesk",
    faces: google(
      "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2",
    ),
  },
  {
    value: "Switzer",
    label: "Switzer",
    faces: variable(
      "https://cdn.fontshare.com/wf/HJHZ26OECMTXRH7JXPFC7EVIHDSLT2RA/LJRNLR7WCPF3PY3SZ7B2LHNUTQMFNCHL/4MCJYGQDIOOXHWSIIB2OYNDBEALJSOGN.woff2",
      [100, 900],
    ),
  },
  {
    value: "Work Sans",
    label: "Work Sans",
    faces: google(
      "https://fonts.gstatic.com/s/worksans/v24/QGYsz_wNahGAdqQ43Rh_fKDptfpA4Q.woff2",
    ),
  },
];

export function resolveWidgetFont(
  family: string | null | undefined,
): WidgetFontOption | null {
  if (!family) return null;
  const value = WIDGET_FONT_ALIASES[family] ?? family;
  return WIDGET_FONTS.find((font) => font.value === value) ?? null;
}

export function isCatalogFont(family: string): boolean {
  const font = resolveWidgetFont(family);
  return Boolean(font && font.faces.length > 0);
}

function weightCss(weight: WidgetFontFace["weight"]): string {
  if (typeof weight === "number") return String(weight);
  return `${weight[0]} ${weight[1]}`;
}

export function fontFaceCss(font: WidgetFontOption): string {
  return font.faces
    .map((face) => {
      const style = face.style ?? "normal";
      return (
        `@font-face{font-family:${JSON.stringify(font.value)};` +
        `font-style:${style};font-weight:${weightCss(face.weight)};` +
        `font-display:swap;src:url(${JSON.stringify(face.src)}) format("woff2")}`
      );
    })
    .join("");
}
