import TagHashtagType from "discourse/lib/hashtag-types/tag";
import { iconHTML } from "discourse/lib/icon-library";
import { withPluginApi } from "discourse/lib/plugin-api";
import { defaultRenderTag } from "discourse/lib/render-tag";
import { contrastColor } from "../lib/colors";

const SVG_NS = "http://www.w3.org/2000/svg";
const CUSTOM_ICON_PREFIX = "custom-icons-";
const CUSTOM_ICONS_CONTAINER_ID = "tag-icons-custom-icons";

/**
 * Parse the custom_svg_icons setting value into structured icon definitions.
 *
 * Input format (pipe-delimited):
 *   "icon_id;viewBox;path1;path2;...|icon_id2;viewBox;path1;..."
 *
 * - viewBox accepts 2 numbers (auto-padded with "0 0") or 4 numbers.
 * - Each remaining field is the "d" data for a <path> element.
 *
 * @param {string} raw - Raw setting value.
 * @returns {{ id: string, viewBox: string, paths: string[] }[]}
 */
function parseCustomSvgIcons(raw) {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(";");
      // Need at least: id, viewBox, one path
      if (parts.length < 3) {
        return null;
      }

      const id = parts[0].trim();
      const viewBoxRaw = parts[1].trim();
      const paths = parts
        .slice(2)
        .map((p) => p.trim())
        .filter(Boolean);

      if (!id || !viewBoxRaw || paths.length === 0) {
        return null;
      }

      // Reject ids that contain characters which would break the HTML id
      // attribute or the <use href="#..."> reference context.
      // Allowed: any non-whitespace character except " < > #
      if (!/^[^\s"<>#]+$/.test(id)) {
        return null;
      }

      // Parse viewBox: 2 or 4 space-separated numbers.
      // Use Number.isFinite to reject NaN, Infinity, and non-numeric junk.
      const viewBoxParts = viewBoxRaw.split(/\s+/).map(Number);
      if (viewBoxParts.some((n) => !Number.isFinite(n))) {
        return null;
      }
      let viewBox;
      if (viewBoxParts.length === 2) {
        viewBox = `0 0 ${viewBoxParts[0]} ${viewBoxParts[1]}`;
      } else if (viewBoxParts.length === 4) {
        viewBox = viewBoxParts.join(" ");
      } else {
        return null;
      }

      return { id, viewBox, paths };
    })
    .filter(Boolean);
}

/**
 * Inject custom SVG icons as <symbol> elements into the DOM so that
 * iconHTML() can resolve them via <use href="#custom-icons-...">.
 *
 * The symbols are placed under:
 *   discourse-assets-icons > div#tag-icons-custom-icons > svg
 *
 * Each <path> child receives fill="currentColor" to inherit the tag's
 * configured --color1 / --color2 CSS custom properties.
 *
 * @param {{ id: string, viewBox: string, paths: string[] }[]} icons
 */
function injectCustomSvgIcons(icons) {
  if (icons.length === 0) {
    return;
  }

  // Locate the Discourse assets container.
  let assetsContainer = document.querySelector("discourse-assets-icons");

  // Create or locate our custom-icons container div.
  let customDiv = document.getElementById(CUSTOM_ICONS_CONTAINER_ID);
  if (!customDiv) {
    customDiv = document.createElement("div");
    customDiv.id = CUSTOM_ICONS_CONTAINER_ID;

    if (assetsContainer) {
      assetsContainer.appendChild(customDiv);
    }
  }

  // Create or reuse the SVG sprite element.
  let svg = customDiv.querySelector("svg");
  if (!svg) {
    svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("xmlns", SVG_NS);
    svg.style.display = "none";
    customDiv.appendChild(svg);
  }

  for (const icon of icons) {
    const symbolId = `${CUSTOM_ICON_PREFIX}${icon.id}`;

    // Avoid duplicates on repeated initializations.
    if (document.getElementById(symbolId)) {
      continue;
    }

    const symbol = document.createElementNS(SVG_NS, "symbol");
    symbol.id = symbolId;
    symbol.setAttribute("viewBox", icon.viewBox);

    for (const d of icon.paths) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "currentColor");
      symbol.appendChild(path);
    }

    svg.appendChild(symbol);
  }
}

function iconTagRenderer(tag, params) {
  // Get the rendered default tag markup.
  const renderedTag = defaultRenderTag(tag, params);

  // Handle both string tags (legacy) and object tags (new format: { id, name, slug })
  const tagName = typeof tag === "string" ? tag : tag.slug || tag.name;

  // Get the tag configuration list from the settings.
  const tagIconList = settings.tag_icon_list.split("|");

  // Returns the tag configuration if found.
  const tagIconItem = tagIconList.find(
    (line) =>
      line.indexOf(",") > -1 &&
      tagName.toLowerCase() === line.substr(0, line.indexOf(",")).toLowerCase()
  );

  // Update the tag markup with an SVG icon, and inline-styles for the colors.
  if (tagIconItem) {
    const [, iconName, color] = tagIconItem.split(",");

    const parser = new DOMParser();
    const tagElement = parser.parseFromString(renderedTag, "text/html").body
      .firstChild;
    const iconElement = parser.parseFromString(
      `<span class="tag-icon">${iconHTML(iconName)}</span>`,
      "text/html"
    ).body.firstChild;

    tagElement.prepend(iconElement);
    tagElement.classList.add("discourse-tag--tag-icons-style");
    tagElement.style.setProperty("--color1", color ?? "");

    tagElement.style.setProperty("--color2", color ? contrastColor(color) : "");

    return tagElement.outerHTML;
  }

  return renderedTag;
}

class TagHashtagTypeWithIcon extends TagHashtagType {
  constructor(dict, owner) {
    super(owner);
    this.dict = dict;
  }

  generateIconHTML(hashtag) {
    const opt = hashtag.slug && this.dict[hashtag.slug];
    if (opt) {
      const svgIcon = iconHTML(opt.icon, {
        class: `hashtag-color--${this.type}-${hashtag.id}`,
      });
      const newIcon = document.createElement("span");
      newIcon.classList.add("hashtag-tag-icon");
      newIcon.innerHTML = svgIcon;
      if (opt.color) {
        newIcon.style.setProperty("--color1", opt.color ?? "");
        newIcon.style.setProperty(
          "--color2",
          opt.color ? contrastColor(opt.color) : ""
        );
      }
      return newIcon.outerHTML;
    }

    return super.generateIconHTML(hashtag);
  }
}

export default {
  name: "tag-icons",

  before: "hashtag-css-generator",

  initialize(owner) {
    // Inject custom SVG icons into the DOM sprite before anything
    // references them via iconHTML() / <use href="#custom-icons-...">.
    const customIcons = parseCustomSvgIcons(settings.custom_svg_icons);
    injectCustomSvgIcons(customIcons);

    withPluginApi((api) => {
      api.replaceTagRenderer(iconTagRenderer);

      /** @type {Record<string, { icon: string, color?: string }>} */
      const tagsMap = {};

      const tagIconList = settings.tag_icon_list.split("|");

      tagIconList.forEach((tagIcon) => {
        const [tagName, prefixValue, prefixColor] = tagIcon.split(",");

        if (tagName && prefixValue) {
          if (api.registerCustomTagSectionLinkPrefixIcon) {
            api.registerCustomTagSectionLinkPrefixIcon({
              tagName,
              prefixValue,
              prefixColor,
            });
          }

          tagsMap[tagName] = {
            icon: prefixValue,
            color: prefixColor,
          };
        }
      });

      if (api.registerHashtagType) {
        api.registerHashtagType(
          "tag",
          new TagHashtagTypeWithIcon(tagsMap, owner)
        );
      }
    });
  },
};
