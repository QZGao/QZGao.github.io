(function () {
    const SEPARATOR_CLASS = 'breadcrumb-sep';

    function parseSegments(value) {
        return value
            .split('|')
            .map(segment => {
                const [labelPart, hrefPart] = segment.split('=>');
                return {
                    label: labelPart ? labelPart.trim() : '',
                    href: hrefPart ? hrefPart.trim() : undefined,
                };
            })
            .filter(segment => segment.label);
    }

    function renderBreadcrumb(container) {
        const rawValue = container.dataset.breadcrumb;
        if (!rawValue) {
            return;
        }

        const segments = parseSegments(rawValue);
        if (!segments.length) {
            return;
        }

        container.innerHTML = '';
        segments.forEach((segment, index) => {
            if (index > 0) {
                const separator = document.createElement('span');
                separator.className = SEPARATOR_CLASS;
                separator.textContent = '/';
                container.appendChild(separator);
            }

            const link = document.createElement('a');
            link.href = segment.href || '#';
            link.textContent = segment.label;
            if (!segment.href) {
                link.classList.add('leaf');
                link.setAttribute('aria-current', 'page');
            }
            container.appendChild(link);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-breadcrumb]').forEach(renderBreadcrumb);
    });
})();
