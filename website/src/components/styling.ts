import { render } from "../../../lib/src";
import { css } from "../../../lib/src/template/css";

const style = css`
	:host {
		padding: 10px;
	}
`;

const currentClass = css`
	padding: 10px;
`;

const otherClass = css`
	${currentClass}
	color: red
`;

const otherStyle = css`
	${style}

	.card {
		margin: 2px;
		${otherClass}
	}

	.card .${otherClass} {
		color: blue;
	}
`;

export const styledComponent = render("styled-component", () => {
	return render.html`
      ${render.css`
          section {
            margin: 1rem;
            background: lightgrey
            }
            
    
        `}
     <section class='card ${otherStyle}'>
         <div>styled</div>
     </section>
  `;
});
