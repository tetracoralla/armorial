import DragIcon from "@icon-park/svg/es/icons/Drag.js";
import FullScreenIcon from "@icon-park/svg/es/icons/FullScreen.js";
import SettingIcon from "@icon-park/svg/es/icons/Setting.js";
import { svgDataUri } from "../svg-data-uri.js";

type Glyph = "move" | "settings" | "expand";

const glyphRenderers = {
  move: DragIcon,
  settings: SettingIcon,
  expand: FullScreenIcon,
} satisfies Record<Glyph, typeof DragIcon>;

type Props = {
  label: string;
  glyph: Glyph;
  onClick: () => void;
};

export function ToolbarIconButton({ label, glyph, onClick }: Props) {
  const svg = glyphRenderers[glyph]({
    size: 17,
    strokeWidth: 3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    theme: "outline",
    fill: "#475569",
  });
  return (
    <button className="toolbar-icon-button" type="button" aria-label={label} title={label} onClick={onClick}>
      <img src={svgDataUri(svg)} alt="" />
    </button>
  );
}
