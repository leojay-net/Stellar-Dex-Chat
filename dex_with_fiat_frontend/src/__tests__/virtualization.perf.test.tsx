import { render, screen, act } from '@testing-library/react';
import { Profiler, memo } from 'react';
import { MessageList } from '../components/MessageList'; // the virtualized list; adjust path/name

const TOTAL = 10_000;
const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 60;
const makeMessages = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, role: 'user', content: `Message ${i}` }));

// jsdom has no layout, so give the scroll container a size or the virtualizer renders nothing.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: VIEWPORT_HEIGHT });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: VIEWPORT_HEIGHT });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: VIEWPORT_HEIGHT, top: 0, left: 0, bottom: VIEWPORT_HEIGHT, right: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
});

describe('message list virtualization', () => {
  it('mounts only a window of rows, not all messages', () => {
    render(<MessageList messages={makeMessages(TOTAL)} />);
    const rows = screen.queryAllByTestId('message-row'); // add data-testid to the row component
    const expectedVisible = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(expectedVisible + 20); // visible + overscan budget
    expect(rows.length).toBeLessThan(TOTAL / 100);
  });

  it('DOM node count stays flat as the list grows', () => {
    const small = render(<MessageList messages={makeMessages(100)} />);
    const smallCount = small.container.querySelectorAll('*').length;
    small.unmount();
    const large = render(<MessageList messages={makeMessages(TOTAL)} />);
    const largeCount = large.container.querySelectorAll('*').length;
    expect(largeCount).toBeLessThanOrEqual(smallCount * 1.5);
  });

  it('appending a message does not re-render existing rows', () => {
    let rowRenders = 0;
    const onRender = () => { rowRenders += 1; };
    const messages = makeMessages(1_000);
    const { rerender } = render(
      <Profiler id="list" onRender={onRender}><MessageList messages={messages} /></Profiler>,
    );
    rowRenders = 0;
    act(() => {
      rerender(
        <Profiler id="list" onRender={onRender}>
          <MessageList messages={[...messages, { id: 'new', role: 'user', content: 'hi' }]} />
        </Profiler>,
      );
    });
    // Profiler fires once per commit, not per row, so count row renders with a counter inside the row
    // component instead (see note below) and assert it equals 1 (just the new row).
  });
});
