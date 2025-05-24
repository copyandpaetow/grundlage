import { render } from "./ssr-render";
const webComponentRegex = () =>
	/<([a-z]+-[a-z0-9-]+)(?:\s+[^>]*)?(?:>[\s\S]*?<\/\1>|\/?>)/gi;

const prerender = async (html: string) => {
	if (!webComponentRegex().test(html)) return html;

	const matches = [...html.matchAll(webComponentRegex())];

	let newHTML = html;

	for await (const match of matches) {
		const [fullMatch, tagName, attributes] = match;

		const withMinimalHtml = `
        <!doctype html>
        <html>
          <body>
              ${fullMatch}
          </body>
        </html>`;

		const rendered = await render(withMinimalHtml, [
			() => import("../website/src/app"),
		]);

		//console.log(rendered);

		newHTML = html.replace(fullMatch, rendered);
	}

	//console.log(newHTML);
	return newHTML;
};

export const prerenderWebcomponents = () => {
	return {
		name: "prerender-webcomponents",

		async transformIndexHtml(html: string) {
			const result = await prerender(html);
			// console.log({ result });
			return result;
		},

		async transform(code, id) {
			// if (!id.endsWith(".html")) return null;

			// Check if file contains any custom elements from your library
			//   const customElementRegex =
			//     /<([a-z][\w]*-[\w-]*)([^>]*)>([\s\S]*?)<\/\1>|<([a-z][\w]*-[\w-]*)([^>]*?)\/>/g;

			//   if (!customElementRegex.test(code)) return null;

			// Find all custom elements and pre-render them
			let transformedCode = code;
			//   const matches = [...code.matchAll(customElementRegex)];

			//   for (const match of matches) {
			//     const [fullMatch, tagName, attributes] = match;

			//     // Check if this is one of your components
			//     if (isYourComponent(tagName)) {
			//       // Create HTML to render
			//       const htmlToRender = `<${tagName}${attributes}></${tagName}>`;

			//       // Import needed component
			//       const componentPath = resolveComponentPath(tagName);

			//       // Replace with pre-rendered HTML in the frontmatter
			//       transformedCode = transformedCode.replace(
			//         fullMatch,
			//         `{() => {
			//             const html = await import('${componentPath}').then(mod => {
			//               return render(\`${htmlToRender}\`, [() => import('${componentPath}')]);
			//             });
			//             return <Fragment set:html={html} />;
			//           }()}`
			//       );
			//     }
			//   }

			return {
				code: transformedCode,
				map: null, // You might want to provide a source map
			};
		},
	};
};
